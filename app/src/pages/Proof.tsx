/**
 * Proof.tsx
 *
 * Public client-facing proof page at /proof/:token. Phone-first.
 *
 * Flow:
 *   1. Parse :token from URL → POST to proof-view → hydrate state.
 *   2. Show hero render + vehicle/design summary + shop branding.
 *   3. Below fold: signature canvas + typed name + ESIGN disclosure checkbox.
 *   4. Three actions: Approve (→ proof-sign), Decline (→ proof-decline),
 *      Request Revision (Phase 3; disabled with "coming soon" badge in Mode B
 *      for now so the UI shape matches the final product).
 *   5. Success state shows signed PDF download link (when generated).
 *
 * No authentication. No account creation. The HMAC-signed token in the URL
 * is the entire auth boundary — verified server-side by every edge function.
 */

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SignatureCanvas } from "@/components/proof/SignatureCanvas";
import { RequestRevisionDialog } from "@/components/proof/RequestRevisionDialog";
import { ReviseConversation } from "@/components/proof/ReviseConversation";
import { AceRevisionRobot } from "@/components/proof/AceRevisionRobot";
import { AceProofStudio } from "@/components/proof/AceProofStudio";
import { PortalIntakePanel } from "@/components/proof/PortalIntakePanel";
import { PortalHeader } from "@/components/proof/PortalHeader";
import { MessageTeamDialog } from "@/components/proof/MessageTeamDialog";
import { ProofVersionTimeline } from "@/components/proof/ProofVersionTimeline";
import { ProofLineItemsGrid, type ProofLineItem } from "@/components/proof/ProofLineItemsGrid";
import { LiftedAssetsCards } from "@/components/proof/LiftedAssetsCards";
import { CheckCircle2, XCircle, FileDown, Loader2, AlertTriangle, Clock, Sparkles, RefreshCw, Maximize2, X, MessageSquare, Send, Download, ClipboardSignature, ChevronLeft, ChevronRight, Home, RotateCw, HelpCircle, Eye, Wand2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface ActivityEvent {
  type: string;
  role: string;
  message?: string | null;
  created_at: string;
}

interface ProofData {
  proof_id: string;
  customer_name?: string | null;
  customer_email: string;
  vehicle?: {
    year?: string | null;
    make?: string | null;
    model?: string | null;
    type?: string | null;
  };
  design_name?: string | null;
  finish_type?: string | null;
  mode: "sign_only" | "revision_loop";
  status: string;
  has_line_items?: boolean;
  expires_at?: string | null;
  message_to_customer?: string | null;
  shop_name?: string | null;
  shop_logo_url?: string | null;
  white_label_logo_url?: string | null;
  original_request?: string | null;
  reference_uploads?: string[];
  ai_revisions: { allowed: number; used: number; remaining: number };
  active_version: {
    id: string;
    version_number: number;
    render_urls: Record<string, string>;
    uploaded_file_paths: string[];
  } | null;
  version_history: Array<{
    id: string;
    version_number: number;
    created_by_role: string;
    is_active: boolean;
    created_at: string;
  }>;
  line_items?: ProofLineItem[];
  activity?: ActivityEvent[];
}

type ViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string; terminal?: boolean }
  | { kind: "loaded"; proof: ProofData }
  | { kind: "signed"; signedPdfUrl: string | null; pdfGenerated: boolean; cartUrl?: string | null; cartSqft?: number | null; cartPrice?: number | null; cartSqftIsEstimate?: boolean; orderIntent?: "ready" | "later" }
  | { kind: "declined" }
  | { kind: "revision_sent" };

function generateIdempotencyKey(): string {
  return (crypto as any).randomUUID?.() ||
    `idem-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// Render the customer's typed name as a cursive PNG so proof-sign gets a
// real signature image even when the customer approved via the one-click
// email link. The audit row still captures IP, user-agent, and timestamp.
function generateTypedSignaturePng(name: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 120;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111111";
  ctx.font = "italic 56px 'Brush Script MT', 'Snell Roundhand', cursive";
  ctx.textBaseline = "middle";
  ctx.fillText(name, 24, 60);
  return canvas.toDataURL("image/png");
}

// Customer-facing 2D/3D proof gating — flip to true later to lock the proofs
// behind payment. For now the buttons reveal the stored proofs (free), but they
// live on the customer UI + reference the stored assets so gating is a one-flag
// change (no re-architecture).
const PROOF_PAY_GATED = false;

function heroImageFromProof(proof: ProofData): string | null {
  const v = proof.active_version;
  if (!v) return null;
  // Never surface admin-only artboard/production sheets as the customer hero.
  const HIDE = new Set(["production_proof", "proof_2d", "master_artboard", "artboard", "flat_artboard"]);
  const firstCustomerView = Object.entries(v.render_urls).find(([k, u]) => u && !HIDE.has(k))?.[1];
  return (
    v.render_urls.hero ||
    v.render_urls.side ||
    v.render_urls.roof ||
    firstCustomerView ||
    v.uploaded_file_paths[0] ||
    null
  );
}

// Customer-visible angles for the ACE portal preview (hero first, then the
// other real renders; admin sheets hidden). Drives the thumbnail strip.
function customerAngles(proof: ProofData): { key: string; label: string; url: string }[] {
  const v = proof.active_version;
  if (!v) return [];
  const HIDE = new Set(["production_proof", "proof_2d", "master_artboard", "artboard", "flat_artboard", "colorway_compare"]);
  const ORDER = ["hero", "side", "driver_side", "passenger_side", "front", "rear", "roof", "hood", "close_up"];
  const label = (k: string) => k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const entries = Object.entries(v.render_urls).filter(([k, u]) => !!u && !HIDE.has(k));
  entries.sort((a, b) => {
    const ia = ORDER.indexOf(a[0]); const ib = ORDER.indexOf(b[0]);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return entries.map(([k, u]) => ({ key: k, label: label(k), url: u as string }));
}

function friendlyStatus(status: string): string {
  const map: Record<string, string> = {
    draft: "In review", sent: "Ready for your review", viewed: "Ready for your review",
    revising: "Revising", revision_loop: "Ready for your review", approved: "Approved", declined: "Declined",
  };
  return map[status] || "Ready for your review";
}

// Canonical view ordering + friendly labels, shared by the hero carousel and
// the all-angles gallery so they read in the same sequence.
const VIEW_ORDER = ["hero", "side", "driver-side", "passenger-side", "front", "rear", "roof", "hood_detail", "hood", "close-up"];
const VIEW_LABELS: Record<string, string> = {
  hero: "Driver Side", side: "Driver Side", "driver-side": "Driver Side",
  "passenger-side": "Passenger Side", front: "Front", rear: "Rear",
  roof: "Roof", hood_detail: "Hood", hood: "Hood", "close-up": "Close-Up",
  production_proof: "2D Production Proof", proof_2d: "2D Proof",
};
// Admin-only / flat-sheet keys never shown as a swipeable 3D angle.
const HERO_HIDE = new Set(["production_proof", "proof_2d", "master_artboard", "artboard", "flat_artboard"]);
// Ordered, de-duplicated list of the customer-visible 3D angle views. When the
// team picked specific angles in the Send composer (portal_includes.views), only
// those are shown — so a bad render (e.g. a "front" that came out as a side) the
// team unchecked never reaches the customer.
function customerViews(proof: ProofData): { type: string; url: string }[] {
  const v = proof.active_version;
  if (!v) return [];
  const pickedRaw = (proof as any).portal_includes?.views;
  const picked = Array.isArray(pickedRaw) && pickedRaw.length ? new Set(pickedRaw) : null;
  const raw = (Object.entries(v.render_urls).filter(([k, u]) => !!u && !HERO_HIDE.has(k) && (!picked || picked.has(k)))) as [string, string][];
  raw.sort((a, b) => {
    const ia = VIEW_ORDER.indexOf(a[0]); const ib = VIEW_ORDER.indexOf(b[0]);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const seen = new Set<string>();
  return raw
    .filter(([, u]) => { if (seen.has(u)) return false; seen.add(u); return true; })
    .map(([type, url]) => ({ type, url }));
}

function vehicleLine(v?: ProofData["vehicle"]): string {
  if (!v) return "";
  return [v.year, v.make, v.model].filter(Boolean).join(" ");
}

export default function Proof() {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const oneClickAction = searchParams.get("action"); // "approve" | "decline" | null
  // Read-only internal preview (?preview=1): the design team views EXACTLY
  // what the customer sees, but the Approve/Decline/Revise actions are hidden
  // so they can't act as the customer. Used by ApprovePro's embedded view.
  const isPreview = searchParams.get("preview") === "1";
  // ACE Revision Robot is LIVE for everyone (flipped on by Trish). Escape hatch:
  // ?ace=0 falls back to the old text revise flow if ever needed.
  const aceRobot = searchParams.get("ace") !== "0";
  const autoFiredRef = useRef(false);
  const [state, setState] = useState<ViewState>({ kind: "loading" });

  // Form state
  const [typedName, setTypedName] = useState("");
  const [signatureBase64, setSignatureBase64] = useState<string | null>(null);
  const [esignConsent, setEsignConsent] = useState(false);
  const [showEsignDetails, setShowEsignDetails] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showDeclineDialog, setShowDeclineDialog] = useState(false);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [heroIdx, setHeroIdx] = useState(0); // hero carousel — which angle is shown
  const [show3D, setShow3D] = useState(false); // 3D proof gallery (all angles) modal
  const [declineReason, setDeclineReason] = useState("");
  const [customerComment, setCustomerComment] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const [checklist, setChecklist] = useState({ spelling: false, colors: false, layout: false, area: false, material: false });
  const [showRevisionDialog, setShowRevisionDialog] = useState(false);
  const [showAIReviseDialog, setShowAIReviseDialog] = useState(false);
  const [reviseSeed, setReviseSeed] = useState<string | null>(null);
  const [showMessageTeam, setShowMessageTeam] = useState(false);
  const [aceEditMsg, setAceEditMsg] = useState("");
  // Stage 1: read-only LayerLift assets (clean background + design PNGs) for this
  // proof, fetched via the token-gated proof-lifted-assets endpoint (service-role
  // read — design_generation_assets is RLS-protected against anon customers).
  const [liftedAssets, setLiftedAssets] = useState<{ backgroundUrl: string | null; overlays: any[] } | null>(null);
  const { toast } = useToast();

  // Fetch the saved LayerLift assets once per token (non-fatal — display only).
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke("proof-lifted-assets", { body: { token } });
        if (!cancelled && data?.success) {
          setLiftedAssets({
            backgroundUrl: data.backgroundUrl ?? null,
            overlays: Array.isArray(data.overlays) ? data.overlays : [],
          });
        }
      } catch {
        // non-fatal — the proof still loads without the separated files
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const loadProof = async (options: { silent?: boolean } = {}) => {
    if (!token) {
      setState({ kind: "error", message: "Missing proof token.", terminal: true });
      return;
    }
    if (!options.silent) setState({ kind: "loading" });
    try {
      const { data, error } = await supabase.functions.invoke("proof-view", {
        body: { token, preview: isPreview },
      });
      if (error) {
        const msg = (data as any)?.error || error.message || "Failed to load proof";
        setState({ kind: "error", message: msg, terminal: true });
        return;
      }
      if (!data?.success) {
        setState({ kind: "error", message: data?.error || "Proof not found", terminal: true });
        return;
      }
      if (data.status === "approved") {
        setState({ kind: "signed", signedPdfUrl: null, pdfGenerated: true });
        return;
      }
      if (data.status === "declined") {
        setState({ kind: "declined" });
        return;
      }
      if (data.status === "revising") {
        setState({ kind: "revision_sent" });
        return;
      }
      // Escalated — still let the client view/sign/decline, but show a
      // support badge. RestylePro team is working on it in parallel.
      setState({ kind: "loaded", proof: data as ProofData });
      if (data.customer_name && !typedName) setTypedName(data.customer_name);
    } catch (err: any) {
      setState({ kind: "error", message: err?.message || "Network error", terminal: true });
    }
  };

  // Hydrate from token on mount / token change
  useEffect(() => {
    loadProof();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // "Approved — I'm ready to order" → take them straight to checkout. A
  // top-level navigation (not a popup) so it isn't blocked, after a short
  // beat on the confirmation so the approval clearly registers.
  useEffect(() => {
    if (state.kind === "signed" && state.orderIntent === "ready" && state.cartUrl) {
      const url = state.cartUrl;
      const t = window.setTimeout(() => { window.location.href = url; }, 2500);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind]);

  // ── One-click email approval / decline ──
  // Email links carry ?action=approve|decline. After the proof loads (and is
  // still in a non-terminal state), fire the action automatically using the
  // customer name on file. For approve, the signature PNG is rendered from
  // the typed name onto an offscreen canvas so proof-sign's contract still
  // gets a real PNG + audit row. Captures IP/UA on the server side.
  useEffect(() => {
    if (autoFiredRef.current) return;
    if (state.kind !== "loaded") return;
    if (oneClickAction !== "approve" && oneClickAction !== "decline" && oneClickAction !== "revise") return;
    autoFiredRef.current = true;

    // ?action=revise (from the proof email "✏️ Revise with AI" button) opens the
    // editor the instant the customer lands — so revising is the first thing they
    // see, not buried below the fold. Self-serve AI editor when revisions remain,
    // otherwise the "request a revision from the shop" path.
    if (oneClickAction === "revise") {
      const p = state.proof;
      // ACE genie is the universal revise experience for ANY AI-enabled order
      // (not just revision_loop mode). When credits are used up ACE itself
      // guides the customer to "Message the design team." Only orders with no
      // AI revisions configured fall back to the manual request dialog.
      if (p.ai_revisions.allowed > 0) {
        setShowAIReviseDialog(true);
      } else {
        setShowRevisionDialog(true);
      }
      return;
    }

    if (oneClickAction === "approve") {
      const name = (state.proof.customer_name || "Customer").trim();
      const sig = generateTypedSignaturePng(name);
      (async () => {
        setSubmitError(null);
        setIsSubmitting(true);
        try {
          const { data, error } = await supabase.functions.invoke("proof-sign", {
            body: {
              token,
              typed_name: name,
              signature_png_base64: sig,
              esign_consent: true,
            },
            headers: { "Idempotency-Key": generateIdempotencyKey() },
          });
          if (error || !data?.success) {
            const msg = (data as any)?.error || error?.message || "Failed to approve";
            setSubmitError(msg);
            return;
          }
          setState({
            kind: "signed",
            signedPdfUrl: data.signed_pdf_url || null,
            pdfGenerated: !!data.pdf_generated,
            cartUrl: data.cart_url || null,
            cartSqft: data.cart_sqft ?? null,
            cartPrice: data.cart_price ?? null,
            cartSqftIsEstimate: data.cart_sqft_is_estimate !== false,
            orderIntent: "later",
          });
        } catch (err: any) {
          setSubmitError(err?.message || "Network error");
        } finally {
          setIsSubmitting(false);
        }
      })();
      return;
    }

    // decline
    (async () => {
      setSubmitError(null);
      setIsSubmitting(true);
      try {
        const { data, error } = await supabase.functions.invoke("proof-decline", {
          body: { token, reason: "Declined via approval email link" },
          headers: { "Idempotency-Key": generateIdempotencyKey() },
        });
        if (error || !data?.success) {
          const msg = (data as any)?.error || error?.message || "Failed to record decline";
          setSubmitError(msg);
          return;
        }
        setState({ kind: "declined" });
      } catch (err: any) {
        setSubmitError(err?.message || "Network error");
      } finally {
        setIsSubmitting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind, oneClickAction]);

  const handleRevert = async (targetVersionId: string) => {
    if (!token) return;
    try {
      const { data, error } = await supabase.functions.invoke("proof-revert-version", {
        body: { token, target_version_id: targetVersionId },
      });
      if (error || !data?.success) {
        const msg = (data as any)?.error || error?.message || "Revert failed";
        toast({ title: "Revert failed", description: msg, variant: "destructive" });
        return;
      }
      toast({
        title: "Reverted",
        description: `v${data.active_version_number} is now active.`,
      });
      await loadProof({ silent: true });
    } catch (err: any) {
      toast({
        title: "Revert failed",
        description: err?.message || "Network error",
        variant: "destructive",
      });
    }
  };

  const handleAIReviseSuccess = async (result: {
    version_number: number;
    credits_remaining: number;
  }) => {
    setShowAIReviseDialog(false);
    toast({
      title: `New version ready — v${result.version_number}`,
      description: `${result.credits_remaining} revisions remaining.`,
    });
    await loadProof({ silent: true });
  };

  const handleSendComment = async () => {
    if (!token || state.kind !== "loaded" || !customerComment.trim()) return;
    const proof = state.proof;
    setSendingComment(true);
    try {
      // Write comment to proof_events via a simple edge function call
      await supabase.functions.invoke("proof-request-revision", {
        body: {
          token,
          change_request: customerComment.trim(),
          is_comment_only: true,
        },
      });
      setCustomerComment("");
      await loadProof({ silent: true });
    } catch {
      // non-fatal
    } finally {
      setSendingComment(false);
    }
  };

  const allChecked = checklist.spelling && checklist.colors && checklist.layout && checklist.area && checklist.material;

  const handleApprove = async (orderIntent: "ready" | "later" = "ready") => {
    if (!token || state.kind !== "loaded") return;
    if (!signatureBase64) {
      setSubmitError("Please draw your signature above.");
      return;
    }
    if (typedName.trim().length < 2) {
      setSubmitError("Please type your full printed name.");
      return;
    }
    if (!esignConsent) {
      setSubmitError("Please check the ESIGN consent box to confirm your signature.");
      return;
    }

    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("proof-sign", {
        body: {
          token,
          typed_name: typedName.trim(),
          signature_png_base64: signatureBase64,
          esign_consent: true,
          order_intent: orderIntent,
        },
        headers: { "Idempotency-Key": generateIdempotencyKey() },
      });
      if (error || !data?.success) {
        const msg = (data as any)?.error || error?.message || "Failed to sign";
        setSubmitError(msg);
        setIsSubmitting(false);
        return;
      }
      setState({
        kind: "signed",
        signedPdfUrl: data.signed_pdf_url || null,
        pdfGenerated: !!data.pdf_generated,
        cartUrl: data.cart_url || null,
        cartSqft: data.cart_sqft ?? null,
        cartPrice: data.cart_price ?? null,
        cartSqftIsEstimate: data.cart_sqft_is_estimate !== false,
        orderIntent,
      });
    } catch (err: any) {
      setSubmitError(err?.message || "Unexpected error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDecline = async () => {
    if (!token || state.kind !== "loaded") return;
    if (declineReason.trim().length < 3) {
      setSubmitError("Please tell the shop why you're declining (min 3 chars).");
      return;
    }
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("proof-decline", {
        body: { token, reason: declineReason.trim() },
        headers: { "Idempotency-Key": generateIdempotencyKey() },
      });
      if (error || !data?.success) {
        const msg = (data as any)?.error || error?.message || "Failed to record decline";
        setSubmitError(msg);
        setIsSubmitting(false);
        return;
      }
      setShowDeclineDialog(false);
      setState({ kind: "declined" });
    } catch (err: any) {
      setSubmitError(err?.message || "Unexpected error");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Render states ─────────────────────────────────────────────────────

  if (state.kind === "loading") {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 text-zinc-600">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-sm">Loading your design...</p>
        </div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
        <Helmet><title>Proof Unavailable</title></Helmet>
        <Card className="max-w-md w-full p-8 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-red-600" />
          </div>
          <h1 className="text-xl font-semibold text-zinc-900">Proof unavailable</h1>
          <p className="text-sm text-zinc-600">{state.message}</p>
          <p className="text-xs text-zinc-400">
            If you believe this is an error, contact the shop that sent you this link.
          </p>
        </Card>
      </div>
    );
  }

  if (state.kind === "signed") {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
        <Helmet><title>Design Approved</title></Helmet>
        <Card className="max-w-md w-full p-8 text-center space-y-5">
          <div className="mx-auto w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900">Design approved 🎉</h1>
            <p className="text-sm text-zinc-600 mt-2">
              {!state.cartUrl
                ? "Thanks — the shop has been notified and will be in touch with next steps."
                : state.orderIntent === "ready"
                  ? "Taking you to checkout now…"
                  : "Approved! We've emailed your cart link — order whenever you're ready."}
            </p>
          </div>

          {state.cartUrl && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-left space-y-3">
              <div className="text-[13px] text-gray-700">
                <span className="font-semibold text-gray-900">Printed wrap</span><br />
                Coverage: {state.cartSqftIsEstimate
                  ? `~${Math.round(state.cartSqft || 0)} sq ft (estimated — confirmed at checkout)`
                  : `${(state.cartSqft || 0).toLocaleString()} sq ft`}<br />
                {state.cartPrice != null && (
                  <>Estimated total: <span className="font-bold text-gray-900">${Math.round(state.cartPrice).toLocaleString()}</span></>
                )}
              </div>
              <Button asChild className="w-full h-12 text-white text-[15px] font-bold"
                style={{ background: "linear-gradient(90deg,#3b82f6,#ec4899)" }}>
                <a href={state.cartUrl} target={state.orderIntent === "ready" ? "_self" : "_blank"} rel="noopener noreferrer">
                  {state.orderIntent === "ready" ? "Continue to checkout →" : "Order my printed wrap →"}
                </a>
              </Button>
              <p className="text-[11px] text-gray-400 text-center">
                {state.orderIntent === "ready"
                  ? "If you're not redirected automatically, tap the button above."
                  : "We also emailed you this link so you can come back to it anytime."}
              </p>
            </div>
          )}

          {state.signedPdfUrl && (
            <Button asChild variant="outline" className="w-full">
              <a href={state.signedPdfUrl} target="_blank" rel="noopener noreferrer">
                <FileDown className="w-4 h-4 mr-2" />
                Download signed PDF
              </a>
            </Button>
          )}
          {!state.signedPdfUrl && state.pdfGenerated === false && !state.cartUrl && (
            <p className="text-xs text-zinc-400">
              Your approval has been recorded. The shop will send you a signed copy shortly.
            </p>
          )}
        </Card>
      </div>
    );
  }

  if (state.kind === "declined") {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
        <Helmet><title>Design Declined</title></Helmet>
        <Card className="max-w-md w-full p-8 text-center space-y-4">
          <div className="mx-auto w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
            <XCircle className="w-8 h-8 text-red-600" />
          </div>
          <h1 className="text-xl font-semibold text-zinc-900">Design declined</h1>
          <p className="text-sm text-zinc-600">The shop has been notified.</p>
        </Card>
      </div>
    );
  }

  if (state.kind === "revision_sent") {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6">
        <Helmet><title>Revision Requested</title></Helmet>
        <Card className="max-w-md w-full p-8 text-center space-y-4">
          <div className="mx-auto w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center">
            <RefreshCw className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-xl font-semibold text-zinc-900">Revision requested</h1>
          <p className="text-sm text-zinc-600">
            The shop has received your feedback and will send an updated design shortly.
            You'll get an email when it's ready.
          </p>
        </Card>
      </div>
    );
  }

  // state.kind === "loaded"
  const { proof } = state;
  const hasLineItems = !!proof.has_line_items && (proof.line_items?.length || 0) > 0;
  const lineItems = proof.line_items || [];
  const lineItemsResolved = hasLineItems
    ? lineItems.every((li) => li.status === "approved" || li.status === "declined")
    : true;
  const lineItemsApprovedCount = lineItems.filter((li) => li.status === "approved").length;
  const hero = hasLineItems
    ? (lineItems[0]?.render_url || lineItems[0]?.thumbnail_url || null)
    : heroImageFromProof(proof);
  // A REAL design (not the WooCommerce product thumbnail that seeds WPW orders).
  // Drives whether the customer still sees the "tell us your ideas + upload"
  // intake panel — they should, on every order, until a real proof exists.
  const heroIsRealDesign = !!hero && !/weprintwraps\.com/i.test(hero);
  const vehicle = vehicleLine(proof.vehicle);
  const expires = proof.expires_at
    ? new Date(proof.expires_at).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  // The friendly ACE studio (AceProofStudio) is the hero experience once a real
  // design exists: it already shows the design, chat, suggestions, and the
  // approve/revise actions. When it's on, the lower section must NOT repeat the
  // big design image + duplicate "Revise Design" CTA (that's the "design shows
  // twice" clutter) — the lower zone becomes upload-more + approve/sign + history.
  const aceStudio = !hasLineItems && heroIsRealDesign && !isPreview && proof.status !== "approved";

  return (
    <div className="min-h-screen bg-gray-100">
      <Helmet>
        <title>
          {proof.design_name || "Your Design"}
          {proof.shop_name ? ` — ${proof.shop_name}` : ""}
          {!proof.white_label_logo_url ? " · ApprovePro" : ""}
        </title>
      </Helmet>

      <div className="lg:grid lg:grid-cols-[230px_1fr]">
        {/* ── ApprovedPro customer rail (desktop). The whole point: the customer
            instantly sees their design (View) and how to change it (Request
            Changes — the prominent gradient CTA). A.C.E is the friendly guide. ── */}
        <aside className="hidden lg:flex flex-col bg-white border-r border-gray-200 sticky top-0 h-screen z-20">
          <div className="flex items-center gap-2 px-5 py-4">
            <img src="/characters/ace-hero.png" onError={(e) => { (e.currentTarget as HTMLImageElement).src = "/characters/ace-robot.png"; }} alt="A.C.E" className="w-9 h-9 object-contain" />
            <span className="font-extrabold tracking-tight text-gray-900">Approved<span className="bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-transparent">Pro</span></span>
          </div>

          {/* A.C.E guide note — tells the customer exactly what to do */}
          <div className="px-4">
            <div className="rounded-xl bg-violet-50 border border-violet-100 p-3 text-[12px] leading-snug text-gray-600">
              <span className="font-semibold text-gray-900">Hi {proof.customer_name?.split(" ")[0] || "there"}! 👋</span> This is your design. Love it? Hit <span className="font-semibold text-gray-900">Approve</span>. Want changes? Tap <span className="font-semibold text-gray-900">Request Changes</span> and A.C.E will redo it for you.
            </div>
          </div>

          {/* Primary action: easy revise */}
          <div className="px-3 pt-3">
            <button onClick={() => (proof.ai_revisions?.allowed ?? 0) > 0 ? setShowAIReviseDialog(true) : setShowRevisionDialog(true)}
              className="w-full h-11 rounded-xl text-white font-bold flex items-center justify-center gap-2 bg-gradient-to-r from-[#3b82f6] to-[#ec4899] hover:brightness-110">
              <Wand2 className="w-4 h-4" /> Request Changes
            </button>
          </div>

          <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
            {[
              { icon: Eye, label: "View Design", onClick: () => window.scrollTo({ top: 0, behavior: "smooth" }), active: true },
              { icon: MessageSquare, label: "Messages", onClick: () => setShowMessageTeam(true) },
              { icon: CheckCircle2, label: "Approve", onClick: () => document.getElementById("proof-approve")?.scrollIntoView({ behavior: "smooth", block: "center" }) },
              { icon: FileDown, label: "Files & Downloads", onClick: () => document.getElementById("proof-approve")?.scrollIntoView({ behavior: "smooth", block: "center" }) },
              { icon: HelpCircle, label: "Help", onClick: () => setShowMessageTeam(true) },
            ].map((n) => (
              <button key={n.label} onClick={n.onClick}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${n.active ? "bg-violet-50 text-violet-700" : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"}`}>
                <n.icon className="w-[18px] h-[18px]" /> {n.label}
              </button>
            ))}
          </nav>
          {hero && (
            <div className="px-3 pb-3">
              <div className="rounded-xl border border-gray-200 p-2.5">
                <div className="aspect-video rounded-md overflow-hidden bg-gray-100 mb-2">
                  <img src={hero} alt="" className="w-full h-full object-cover" />
                </div>
                <p className="text-[12px] font-semibold text-gray-900 truncate">{proof.design_name || "Your wrap design"}</p>
                <p className="text-[11px] text-gray-400 truncate">{vehicle || proof.shop_name || ""}</p>
              </div>
            </div>
          )}
          <div className="px-5 py-3 border-t border-gray-200">
            <p className="text-sm font-semibold text-gray-900 truncate">{proof.customer_name || "Your design"}</p>
            <p className="text-[11px] text-gray-400">Secured by ApprovedPro™</p>
          </div>
        </aside>

        {/* ── Content column ── */}
        <div className="min-w-0 pb-24">

      {/* Header — co-branded: shop logo + name on the left, ApprovePro
          wordmark on the right. Customer immediately sees they're on a
          professional ApprovePro experience from their shop, not some
          random link. The gradient bar matches the ApprovePro brand
          (blue → pink) so the page reads as "ApprovePro by Shop". */}
      <header className="sticky top-0 z-10">
        <div className="h-1 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />
        <div className="bg-white border-b border-zinc-200 shadow-sm">
          <div className="max-w-[1400px] mx-auto px-4 py-3 flex items-center justify-between gap-3">
            {/* Shop brand — LARGE. The customer's shop is the star of the page. */}
            <div className="flex items-center gap-3 min-w-0">
              {(proof.white_label_logo_url || proof.shop_logo_url) && (
                <img
                  src={proof.white_label_logo_url || proof.shop_logo_url || ""}
                  alt={proof.shop_name || ""}
                  className="h-11 sm:h-12 w-auto max-w-[180px] object-contain shrink-0"
                />
              )}
              <div className="min-w-0">
                <p className="text-[10px] font-semibold tracking-[0.15em] uppercase text-zinc-400 leading-none mb-1">
                  Design Proof from
                </p>
                <p className="text-xl sm:text-3xl font-extrabold text-zinc-900 leading-none truncate">
                  {proof.shop_name || "WePrintWraps.com"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {expires && (
                <div className="hidden sm:flex text-xs text-zinc-500 items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Expires {expires}
                </div>
              )}
              {/* ApprovePro — small co-brand logo. Hidden when the shop applied a
                  white-label logo (they pay for ApprovePro branding NOT to show). */}
              {!proof.white_label_logo_url && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="w-5 h-5 rounded-md bg-gradient-to-br from-[#3b82f6] to-[#ec4899] flex items-center justify-center shrink-0">
                    <ClipboardSignature className="w-3 h-3 text-white" />
                  </div>
                  <span className="text-[11px] font-bold leading-none whitespace-nowrap">
                    <span className="text-zinc-700">Approve</span>
                    <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">Pro</span>
                  </span>
                </div>
              )}
            </div>
          </div>
          {expires && (
            <div className="sm:hidden max-w-3xl mx-auto px-4 pb-2 -mt-1 text-[11px] text-zinc-500 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Expires {expires}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-[1500px] mx-auto px-4 py-6">

       {/* ══ A.C.E GREETING — the customer tells A.C.E what to change, right here.
           Mascot on the left, greeting + an "edit" chat box on the right. Branded
           to the shop (WePrintWraps.com). Typing seeds the revise genie. ══ */}
       {aceStudio && (
         <div className="mb-6 rounded-2xl overflow-hidden border border-violet-100 bg-gradient-to-br from-violet-100/70 via-fuchsia-50 to-white">
           <div className="flex flex-col sm:flex-row items-center gap-4 p-5">
             <img src="/characters/ace-hero.png" onError={(e) => { (e.currentTarget as HTMLImageElement).src = "/characters/ace-robot.png"; }} alt="A.C.E" className="w-28 h-28 sm:w-32 sm:h-32 object-contain drop-shadow-xl shrink-0" />
             <div className="flex-1 min-w-0 w-full text-center sm:text-left">
               <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 leading-tight">Hi {proof.customer_name?.split(" ")[0] || "there"}! 👋 Here's your design</h1>
               <p className="text-[13px] text-gray-600 mt-1">
                 Your {vehicle ? `${vehicle} ` : ""}wrap from <span className="font-semibold text-gray-900">{proof.shop_name || "WePrintWraps.com"}</span>. Love it? Approve below. Want changes? Just tell me and I'll redo it.
               </p>
               <div className="mt-3 flex items-center gap-2 bg-white rounded-xl border border-gray-200 p-1.5 shadow-sm max-w-xl mx-auto sm:mx-0">
                 <input
                   value={aceEditMsg}
                   onChange={(e) => setAceEditMsg(e.target.value)}
                   onKeyDown={(e) => { if (e.key === "Enter" && aceEditMsg.trim()) { setReviseSeed(aceEditMsg.trim()); (proof.ai_revisions?.allowed ?? 0) > 0 ? setShowAIReviseDialog(true) : setShowRevisionDialog(true); setAceEditMsg(""); } }}
                   placeholder="Tell A.C.E what to change… (e.g. make the logo bigger)"
                   className="flex-1 min-w-0 px-3 py-2 text-sm bg-transparent outline-none text-gray-900 placeholder:text-gray-400"
                 />
                 <button
                   onClick={() => { const t = aceEditMsg.trim(); if (!t) return; setReviseSeed(t); (proof.ai_revisions?.allowed ?? 0) > 0 ? setShowAIReviseDialog(true) : setShowRevisionDialog(true); setAceEditMsg(""); }}
                   disabled={!aceEditMsg.trim()}
                   className="h-9 px-4 shrink-0 rounded-lg text-white font-bold text-sm flex items-center gap-1.5 disabled:opacity-40 bg-gradient-to-r from-[#3b82f6] to-[#ec4899] hover:brightness-110">
                   <Wand2 className="w-4 h-4" /> Edit
                 </button>
               </div>
             </div>
           </div>
         </div>
       )}

       {/* ══ ACE PORTAL — the friendly "talk to ACE, revise easy" dashboard
           (Zoltar-style). Shown front-and-center the moment a real design
           exists. Approve scrolls to the sign section below; Request a Revision
           opens the ACE revise genie; suggestions one-tap into a revision. ══ */}
       {aceStudio && (
         <div className="mb-6">
           <AceProofStudio
             token={token!}
             customerName={proof.customer_name}
             designName={proof.design_name}
             shopName={proof.shop_name}
             vehicleLabel={vehicle}
             statusLabel={friendlyStatus(proof.status)}
             angles={customerAngles(proof)}
             remaining={proof.ai_revisions?.remaining ?? 0}
             allowed={proof.ai_revisions?.allowed ?? 0}
             canRevise={(proof.ai_revisions?.allowed ?? 0) > 0}
             onApprove={() => document.getElementById("proof-approve")?.scrollIntoView({ behavior: "smooth", block: "center" })}
             onRequestRevision={(seed) => {
               setReviseSeed(seed || null);
               if ((proof.ai_revisions?.allowed ?? 0) > 0) setShowAIReviseDialog(true);
               else setShowRevisionDialog(true);
             }}
             onZoom={(u) => setZoomImage(u)}
           />
         </div>
       )}

       <div className="lg:grid lg:grid-cols-12 lg:gap-5 lg:items-start space-y-6 lg:space-y-0">

        {/* ══ LEFT RAIL — status, revisions included, upload assets + clear
            instructions (above the fold so the customer immediately knows they
            can add details / revise themselves). ══ */}
        <div className="lg:col-span-3 space-y-5">
        {/* PortalHeader (the "Meet Ace" banner) is redundant once the ACE studio
            above is the hero — hide it there so the page reads as one flow. */}
        {!hasLineItems && !aceStudio && (
          <PortalHeader
            shopName={proof.shop_name}
            shopLogoUrl={proof.shop_logo_url}
            whiteLabelLogoUrl={proof.white_label_logo_url}
            status={proof.status}
            hasDesign={!!hero}
            onMessageTeam={() => setShowMessageTeam(true)}
          />
        )}
        {/* Revisions included — already shown in the ACE studio's Project Details,
            so only show here when the studio isn't the hero. */}
        {!hasLineItems && !aceStudio && proof.ai_revisions && proof.ai_revisions.allowed > 0 && proof.status !== "approved" && (
          <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-900">Revisions included</p>
            <p className="text-2xl font-extrabold text-blue-700 leading-tight">{proof.ai_revisions.remaining}<span className="text-sm font-bold text-blue-400"> / {proof.ai_revisions.allowed} left</span></p>
            <p className="text-[11px] text-blue-700/80">Edit the design yourself, right here.</p>
          </div>
        )}
        {/* Upload assets + clear instructions — always visible until approved */}
        {proof.status !== "approved" && !isPreview && (
          <PortalIntakePanel
            token={token!}
            status={proof.status}
            hasDesign={heroIsRealDesign}
            shopName={proof.shop_name}
            onSubmitted={() => loadProof({ silent: true })}
          />
        )}
        </div>

        {/* ══ CENTER — the design proof (hero + angle carousel) ══ */}
        <div className="lg:col-span-6 space-y-5">
        {/* Hero — hidden when the ACE studio above already shows the design,
            so the design never appears twice on the page. */}
        {!aceStudio && (
        <section>
          <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900">
            {proof.design_name || "Your Design"}
          </h1>
          {vehicle && <p className="text-sm text-zinc-600 mt-1">{vehicle}</p>}
          {proof.finish_type && (
            <p className="text-xs text-zinc-500 mt-1">
              Finish: <span className="capitalize">{proof.finish_type}</span>
            </p>
          )}

          {/* Only show the big hero image once there's a REAL A.C.E design —
              never the customer's product thumbnail (that pushed the intake
              form below the fold at the intake stage). */}
          {!hasLineItems && hero && heroIsRealDesign && (() => {
            // Hero carousel — left/right arrows skim through every angle without
            // leaving the page. Falls back to the single hero when there's one view.
            const views = customerViews(proof);
            const idx = views.length ? Math.min(heroIdx, views.length - 1) : 0;
            const cur = views[idx];
            const img = cur?.url || hero;
            const label = cur ? (VIEW_LABELS[cur.type] || cur.type.replace(/-|_/g, " ")) : null;
            const go = (d: number) => { if (views.length) setHeroIdx((views.length + idx + d) % views.length); };
            return (
              <div className="mt-4 rounded-xl overflow-hidden border border-zinc-200 bg-white relative group">
                <img src={img} alt={label || proof.design_name || "Design"} className="w-full max-h-[55vh] object-contain bg-white cursor-zoom-in" onClick={() => setZoomImage(img)} />
                {views.length > 1 && (
                  <>
                    {/* News-reel style (matches RevisionStudio): translucent round
                        arrows over the SAME image, white dots, an i/N badge. */}
                    <button
                      onClick={(e) => { e.stopPropagation(); go(-1); }}
                      aria-label="Previous view"
                      title="Previous view"
                      className="absolute left-1.5 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white transition-all touch-manipulation"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); go(1); }}
                      aria-label="Next view"
                      title="Next view"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white transition-all touch-manipulation"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                    <span className="absolute top-2 left-1/2 -translate-x-1/2 z-20 bg-black/60 text-white rounded-full px-2.5 py-0.5 text-[11px] font-semibold">
                      {label ? `${label} · ` : ""}{idx + 1}/{views.length}
                    </span>
                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1">
                      {views.map((_, i) => (
                        <button
                          key={i}
                          onClick={(e) => { e.stopPropagation(); setHeroIdx(i); }}
                          aria-label={`View ${i + 1}`}
                          className={cn("w-2.5 h-2.5 rounded-full transition-all touch-manipulation", i === idx ? "bg-white scale-125" : "bg-white/40")}
                        />
                      ))}
                    </div>
                  </>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); setZoomImage(img); }}
                  className="absolute bottom-3 right-3 bg-white/95 hover:bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-zinc-800 shadow-md flex items-center gap-1.5"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  Tap to enlarge
                </button>
              </div>
            );
          })()}

          {/* BIG REVISE — the primary edit CTA, right under the design proof so
              customers don't miss it (and don't reply by email). Opens the same
              revise flow as the action below. */}
          {!hasLineItems && hero && heroIsRealDesign && !isPreview && proof.status !== "approved" && (
            <Button
              onClick={() =>
                proof.ai_revisions.allowed > 0
                  ? setShowAIReviseDialog(true)
                  : setShowRevisionDialog(true)
              }
              disabled={isSubmitting}
              className="mt-4 w-full h-14 text-lg font-extrabold text-white shadow-md"
              style={{ background: "linear-gradient(90deg,#3b82f6,#ec4899)" }}
            >
              <Sparkles className="w-5 h-5 mr-2" />
              Need to edit? Revise Design
              {proof.mode === "revision_loop" && proof.ai_revisions.allowed > 0 && proof.ai_revisions.remaining > 0
                ? ` (${proof.ai_revisions.remaining} left)`
                : ""}
            </Button>
          )}
        </section>
        )}

        {/* Colorways — when the shop sent more than one colorway (e.g. White +
            Black), show the side-by-side comparison so the customer can pick. */}
        {!hasLineItems && (proof.active_version?.render_urls as any)?.colorway_compare && (
          <section>
            <h2 className="text-sm font-semibold text-zinc-900 mb-2">Colorway options — compare</h2>
            <a href={(proof.active_version!.render_urls as any).colorway_compare} target="_blank" rel="noreferrer" className="block rounded-xl overflow-hidden border border-zinc-200 bg-white">
              <img src={(proof.active_version!.render_urls as any).colorway_compare} alt="Colorway comparison" className="w-full object-contain bg-white cursor-zoom-in" onClick={(e) => { e.preventDefault(); setZoomImage((proof.active_version!.render_urls as any).colorway_compare); }} />
            </a>
          </section>
        )}

        {/* Phase 5: escalated-to-support banner */}
        {proof.status === "escalated_support" && (
          <Card className="p-4 bg-amber-50 border-amber-200 flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
              <span className="text-lg" aria-hidden>🛟</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-900">
                RestylePro Support is on this
              </p>
              <p className="text-xs text-amber-800 mt-0.5">
                The shop escalated this proof for hands-on help. You can still
                approve, decline, or request a revision — a RestylePro designer
                is reviewing in the background.
              </p>
            </div>
          </Card>
        )}

        {/* Version + Download bar */}
        <Card className="p-3 bg-white border-zinc-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {proof.active_version && (
              <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs">
                Version {proof.active_version.version_number}
              </Badge>
            )}
            <Badge className={cn(
              "text-xs",
              proof.status === "approved" ? "bg-green-100 text-green-700 border-green-200" :
              proof.status === "declined" ? "bg-red-100 text-red-700 border-red-200" :
              proof.status === "revising" ? "bg-purple-100 text-purple-700 border-purple-200" :
              "bg-blue-100 text-blue-700 border-blue-200"
            )}>
              {proof.status === "viewed" ? "Awaiting Review" : proof.status.charAt(0).toUpperCase() + proof.status.slice(1)}
            </Badge>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {(() => {
              // 2D + 3D proof buttons — stored on the customer UI + pay-gate-ready.
              const proof2dUrl = (proof.active_version?.render_urls as any)?.production_proof;
              const proofBtn = (label: string, url: string | null | undefined) => {
                if (!url) return null;
                if (PROOF_PAY_GATED) {
                  return (
                    <Button key={label} variant="outline" size="sm" disabled
                      title="Unlock with the Pro Design Pack" className="gap-1.5 text-xs border-zinc-300">
                      🔒 {label}
                    </Button>
                  );
                }
                return (
                  <a key={label} href={url} target="_blank" rel="noreferrer" className="inline-flex">
                    <Button variant="outline" size="sm" className="gap-1.5 text-xs border-zinc-300">📄 {label}</Button>
                  </a>
                );
              };
              // The team can choose what's shown via the Send dialog. When unset,
              // show everything available (back-compat).
              const inc = (proof as any).portal_includes as { twoD?: boolean; threeD?: boolean } | null | undefined;
              const show2d = inc?.twoD !== false;
              const show3d = inc?.threeD !== false;
              // 3D Proof = the multi-angle on-vehicle set, NOT a single side.
              const v3d = customerViews(proof);
              const btn3d = (!show3d || v3d.length === 0) ? null : PROOF_PAY_GATED ? (
                <Button variant="outline" size="sm" disabled title="Unlock with the Pro Design Pack" className="gap-1.5 text-xs border-zinc-300">🔒 3D Proof</Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setShow3D(true)} className="gap-1.5 text-xs border-zinc-300">📄 3D Proof ({v3d.length})</Button>
              );
              return (
                <>
                  {show2d && proofBtn("2D Proof", proof2dUrl)}
                  {btn3d}
                </>
              );
            })()}
            {hero && (
              <a href={hero} download className="inline-flex">
                <Button variant="outline" size="sm" className="gap-1.5 text-xs border-zinc-300">
                  <Download className="w-3.5 h-3.5" />
                  Download Proof
                </Button>
              </a>
            )}
          </div>
        </Card>

        {/* Optional shop message */}
        {proof.message_to_customer && (() => {
          // Stamp the message with WHEN it was sent (date + time), mirroring the
          // admin timeline. Derived from the latest sent/resent activity event.
          const sentEv = [...(proof.activity || [])].reverse().find((e) => e.type === "sent" || e.type === "resent");
          const sentTime = sentEv
            ? new Date(sentEv.created_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
            : null;
          return (
          <Card className="p-4 bg-blue-50 border-blue-100">
            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
              </div>
              <div>
                <div className="flex items-baseline gap-2 mb-0.5 flex-wrap">
                  <p className="text-xs font-semibold text-blue-800">Message from your shop</p>
                  {sentTime && <span className="text-[10px] text-blue-500">{sentTime}</span>}
                </div>
                <p className="text-sm text-zinc-800 whitespace-pre-wrap">
                  {proof.message_to_customer}
                </p>
              </div>
            </div>
          </Card>
          );
        })()}

        {/* Activity timeline */}
        {proof.activity && proof.activity.length > 0 && (
          <Card className="p-4 bg-white border-zinc-200">
            <h2 className="text-sm font-semibold text-zinc-900 mb-3 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-zinc-400" />
              Activity
            </h2>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {proof.activity.map((ev, i) => {
                const isShop = ev.role === "shop" || ev.role === "system";
                const label =
                  ev.type === "sent" ? "Proof sent for review" :
                  ev.type === "viewed" ? "You viewed this proof" :
                  ev.type === "signed" ? "Proof approved & signed" :
                  ev.type === "declined" ? "Proof declined" :
                  ev.type === "revision_requested" ? "Revision requested" :
                  ev.type === "version_saved" ? "New version uploaded" :
                  ev.type === "shop_reply" ? (ev.message || "Shop replied") :
                  ev.type === "customer_comment" ? (ev.message || "You commented") :
                  ev.type === "ai_revise_completed" ? "AI revision completed" :
                  ev.type;
                const time = new Date(ev.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
                return (
                  <div key={i} className={cn("flex items-start gap-2.5 text-sm", isShop ? "" : "flex-row-reverse text-right")}>
                    <div className={cn("w-2 h-2 rounded-full mt-1.5 shrink-0", isShop ? "bg-blue-400" : "bg-green-400")} />
                    <div>
                      <p className="text-zinc-800">{label}</p>
                      <p className="text-[10px] text-zinc-400">{time}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Customer comment box */}
        {!["approved", "declined", "revoked", "expired"].includes(proof.status) && (
          <Card className="p-4 bg-white border-zinc-200">
            <h2 className="text-sm font-semibold text-zinc-900 mb-2 flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5 text-zinc-400" />
              Your comment
            </h2>
            <div className="flex gap-2">
              <Textarea
                value={customerComment}
                onChange={(e) => setCustomerComment(e.target.value)}
                placeholder="Type a comment or question for the shop..."
                className="min-h-[60px] text-sm flex-1 resize-none bg-zinc-50 border-zinc-200"
                disabled={sendingComment}
              />
              <Button
                onClick={handleSendComment}
                disabled={sendingComment || !customerComment.trim()}
                size="sm"
                className="self-end bg-gradient-to-r from-blue-500 to-indigo-600 text-white border-0 h-9 px-3"
              >
                {sendingComment ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </Button>
            </div>
          </Card>
        )}

        {/* Line items — Phase 8C */}
        {hasLineItems && (
          <ProofLineItemsGrid
            items={lineItems}
            token={token!}
            mode={proof.mode}
            disabled={isSubmitting}
            onChange={() => loadProof({ silent: true })}
          />
        )}

        {/* All sides — every angle, driver-side first, deduped (no duplicate
            hero, no 2D-proof sheet), friendly labels. Hidden with line items. */}
        {!hasLineItems && proof.active_version && (() => {
          const VIEW_ORDER = ["hero", "side", "driver-side", "passenger-side", "front", "rear", "roof", "hood_detail", "hood", "close-up"];
          const VIEW_LABELS: Record<string, string> = {
            hero: "Driver Side", side: "Driver Side", "driver-side": "Driver Side",
            "passenger-side": "Passenger Side", front: "Front", rear: "Rear",
            roof: "Roof", hood_detail: "Hood", hood: "Hood", "close-up": "Close-Up",
            production_proof: "2D Production Proof", proof_2d: "2D Proof",
          };
          // Artboard + production sheets are RestyleProAI/admin property — the
          // customer sees the 3D angles only, never the flat master artboard.
          // Customer sees the 3D angles AND the 2D production proof — only the
          // flat artboard is admin-only (RestyleProAI property). Transparent
          // element PNGs + clean background live in design_generation_assets and
          // are never in render_urls, so they're admin-only by nature.
          const SKIP = new Set(["master_artboard", "artboard", "flat_artboard"]);
          const pk = (proof as any).portal_includes?.views;
          const picked = Array.isArray(pk) && pk.length ? new Set(pk) : null;
          const raw = (Object.entries(proof.active_version.render_urls)
            .filter(([k, u]) => !!u && !SKIP.has(k) && (!picked || picked.has(k) || k === "production_proof"))) as [string, string][];
          raw.sort((a, b) => {
            const ia = VIEW_ORDER.indexOf(a[0]); const ib = VIEW_ORDER.indexOf(b[0]);
            return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
          });
          const seen = new Set<string>();
          const views = raw.filter(([, u]) => { if (seen.has(u)) return false; seen.add(u); return true; });
          if (views.length <= 1) return null;
          return (
            <section>
              <h2 className="text-sm font-semibold text-zinc-900 mb-2">All angles — swipe to see every side →</h2>
              <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4 [scrollbar-width:thin]">
                {views.map(([type, url]) => (
                  <div key={type} className="shrink-0 w-[82%] sm:w-[46%] lg:w-[31%] snap-start rounded-lg overflow-hidden border border-zinc-200 bg-white group relative cursor-zoom-in" onClick={() => setZoomImage(url)}>
                    <img src={url} alt={VIEW_LABELS[type] || type} className="w-full h-auto aspect-video object-cover" />
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 text-center py-1.5">
                      {VIEW_LABELS[type] || type.replace(/-|_/g, " ")}
                    </p>
                    <button
                      onClick={(e) => { e.stopPropagation(); setZoomImage(url); }}
                      className="absolute bottom-7 right-2 bg-white/95 hover:bg-white border border-zinc-200 rounded px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700 shadow-sm flex items-center gap-1"
                    >
                      <Maximize2 className="w-2.5 h-2.5" />
                      Enlarge
                    </button>
                  </div>
                ))}
              </div>
            </section>
          );
        })()}

        {/* Separated design files — clean background + lifted logo/text PNGs.
            Customers can grab these when they revise. (Stage 1: display +
            download; interactive drag-to-place LayerLift lands next.) */}
        {!hasLineItems && liftedAssets && (liftedAssets.backgroundUrl || liftedAssets.overlays.length > 0) && (
          <section>
            <h2 className="text-sm font-semibold text-zinc-900 mb-2">Your design files — separated layers</h2>
            <LiftedAssetsCards backgroundUrl={liftedAssets.backgroundUrl} overlays={liftedAssets.overlays} />
          </section>
        )}

        {/* Pre-approval checklist */}
        {!["approved", "declined", "revoked", "expired"].includes(proof.status) && (
          <Card className="p-4 sm:p-6 bg-white border-zinc-200">
            <h2 className="text-sm font-semibold text-zinc-900 mb-3">If everything looks right:</h2>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {(["spelling", "colors", "layout", "area", "material"] as const).map((key) => (
                <label
                  key={key}
                  className={cn(
                    "flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors text-sm",
                    checklist[key] ? "border-blue-400 bg-blue-50 text-blue-800" : "border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100"
                  )}
                >
                  <Checkbox
                    checked={checklist[key]}
                    onCheckedChange={(v) => setChecklist((prev) => ({ ...prev, [key]: v === true }))}
                  />
                  <span className="capitalize font-medium">{key}</span>
                </label>
              ))}
            </div>
            {!allChecked && (
              <p className="text-xs text-zinc-400 mt-2">Check all items to confirm you've reviewed the proof</p>
            )}
          </Card>
        )}

        {/* Internal read-only preview banner (design team viewing in ApprovePro). */}
        {isPreview && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-[13px] text-blue-900 font-medium text-center">
            👁️ Internal preview — this is exactly what the customer sees. Actions are hidden here.
          </div>
        )}

        </div>

        {/* ══ RIGHT RAIL — review, approve / decline, and version history ══ */}
        <div className="lg:col-span-3 space-y-5">
        {/* Sign section — hidden in internal preview so the team can't act as the customer. */}
        {!isPreview && (
        <Card id="sign-section" className="p-4 sm:p-6 space-y-5 bg-white border-zinc-200">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">
              {hasLineItems ? "Sign to finalize" : "Review & Sign"}
            </h2>
            <p className="text-sm text-zinc-600 mt-1">
              {hasLineItems
                ? lineItemsResolved
                  ? `All ${lineItems.length} items resolved (${lineItemsApprovedCount} approved). Sign below to lock in every outcome.`
                  : `Resolve every item above (approve, decline, or request revision), then sign once to finalize the proof.`
                : proof.mode === "revision_loop"
                ? "Approve the design to move it to production, or request a revision."
                : "Approve the design to confirm — or decline with a reason."}
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Draw your signature</Label>
            <SignatureCanvas
              onSignatureChange={setSignatureBase64}
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="typed-name" className="text-sm">
              Type your full printed name
            </Label>
            <Input
              id="typed-name"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder="e.g. Jane Q. Smith"
              disabled={isSubmitting}
              className="h-11"
              autoComplete="name"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-start gap-3">
              <Checkbox
                id="esign"
                checked={esignConsent}
                onCheckedChange={(v) => setEsignConsent(v === true)}
                disabled={isSubmitting}
                className="mt-0.5"
              />
              <Label
                htmlFor="esign"
                className="text-sm font-normal text-zinc-700 leading-snug cursor-pointer"
              >
                I agree my electronic signature has the same legal force as a
                handwritten signature, and I intend to sign this proof.{" "}
                <button
                  type="button"
                  onClick={() => setShowEsignDetails((v) => !v)}
                  className="text-blue-600 underline text-xs"
                >
                  {showEsignDetails ? "Hide" : "Read"} ESIGN disclosure
                </button>
              </Label>
            </div>
            {showEsignDetails && (
              <div className="text-xs text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-md p-3 leading-relaxed">
                Under the U.S. Electronic Signatures in Global and National
                Commerce Act (ESIGN, 15 U.S.C. § 7001 et seq.) and the Uniform
                Electronic Transactions Act (UETA) as adopted by your state,
                this electronic record cannot be denied legal effect solely
                because it is in electronic form. You may request a paper copy
                from the shop at any time. You may withdraw consent to
                electronic signing by notifying the shop before the next
                action in the transaction.
              </div>
            )}
          </div>

          {submitError && (
            <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-sm p-3">
              {submitError}
            </div>
          )}

          {hasLineItems ? (
            <div id="proof-approve" className="grid gap-3 scroll-mt-20 grid-cols-1">
              <Button
                onClick={() => handleApprove()}
                disabled={isSubmitting || !lineItemsResolved || !allChecked}
                className="h-12 text-base font-semibold bg-gradient-to-r from-blue-500 to-indigo-600 hover:opacity-90 text-white border-0"
              >
                {isSubmitting ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Signing…</>
                ) : (
                  <><CheckCircle2 className="w-5 h-5 mr-2" /> Sign &amp; Finalize</>
                )}
              </Button>
            </div>
          ) : (
            <div id="proof-approve" className="space-y-2.5 scroll-mt-20">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">How would you like to proceed?</p>

              {/* 1. Approved — ready to order now (hottest intent → straight to checkout) */}
              <Button
                onClick={() => handleApprove("ready")}
                disabled={isSubmitting || !allChecked}
                className="w-full h-12 text-base font-semibold bg-gradient-to-r from-blue-500 to-indigo-600 hover:opacity-90 text-white border-0"
              >
                {isSubmitting ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Approving…</>
                ) : (
                  <><CheckCircle2 className="w-5 h-5 mr-2" /> Approved — I'm ready to order</>
                )}
              </Button>

              {/* 2. Approved — ordering later (we email the cart link) */}
              <Button
                onClick={() => handleApprove("later")}
                disabled={isSubmitting || !allChecked}
                variant="outline"
                className="w-full h-12 text-base font-semibold border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-400"
              >
                <CheckCircle2 className="w-5 h-5 mr-2" />
                Approved — I'll order later
              </Button>

              {/* 3. Revise NOW — ACE genie for any AI-enabled order, else ask the shop */}
              <Button
                onClick={() =>
                  proof.ai_revisions.allowed > 0
                    ? setShowAIReviseDialog(true)
                    : setShowRevisionDialog(true)
                }
                disabled={isSubmitting}
                variant="outline"
                className="w-full h-12 text-base font-semibold border-purple-300 text-purple-700 hover:bg-purple-50 hover:border-purple-400"
              >
                <Sparkles className="w-5 h-5 mr-2" />
                Revise Design
                {proof.mode === "revision_loop" && proof.ai_revisions.allowed > 0 && proof.ai_revisions.remaining > 0
                  ? ` (${proof.ai_revisions.remaining} ${proof.ai_revisions.remaining === 1 ? "revision" : "revisions"} left)`
                  : ""}
              </Button>

              {/* Secondary: decline + ask-the-shop */}
              <div className="flex items-center gap-2 pt-1">
                <Button
                  onClick={() => setShowDeclineDialog(true)}
                  disabled={isSubmitting}
                  variant="ghost"
                  className="flex-1 h-9 text-sm text-zinc-500 hover:text-zinc-700"
                >
                  <XCircle className="w-4 h-4 mr-1.5" /> Decline
                </Button>
                {proof.mode === "revision_loop" && (
                  <Button
                    onClick={() => setShowRevisionDialog(true)}
                    disabled={isSubmitting}
                    variant="ghost"
                    className="flex-1 h-9 text-sm text-blue-700 hover:text-blue-800 hover:bg-blue-50"
                  >
                    <RefreshCw className="w-4 h-4 mr-1.5" /> Ask the shop
                  </Button>
                )}
              </div>
            </div>
          )}
        </Card>
        )}

        {/* Your request — the "source of truth": what you originally asked us to
            design + any reference images you uploaded, so you can compare it
            against the design above. */}
        {(proof.original_request || (proof.reference_uploads && proof.reference_uploads.length > 0)) && (
          <section className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-block w-1.5 h-5 rounded-full bg-gradient-to-b from-[#3b82f6] to-[#ec4899]" />
              <h2 className="text-base font-bold text-gray-900">Your request</h2>
              <span className="text-xs text-gray-500 ml-1">what you asked us to design</span>
            </div>
            {proof.original_request && (
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{proof.original_request}</p>
            )}
            {proof.reference_uploads && proof.reference_uploads.length > 0 && (
              <div className="mt-4">
                <div className="text-xs font-semibold text-gray-500 mb-2">
                  Your reference{proof.reference_uploads.length === 1 ? "" : "s"} ({proof.reference_uploads.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {proof.reference_uploads.map((url, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setZoomImage(url)}
                      className="block w-20 h-20 rounded-lg overflow-hidden border border-gray-200 bg-gray-50 hover:ring-2 hover:ring-[#3b82f6] transition"
                    >
                      <img src={url} alt={`Reference ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Version timeline — Phase 3 + Phase 4 revert */}
        {proof.version_history && proof.version_history.length > 1 && (
          <section>
            <h2 className="text-sm font-semibold text-zinc-900 mb-2">Version history</h2>
            <ProofVersionTimeline
              versions={proof.version_history}
              onRevert={handleRevert}
            />
          </section>
        )}

        </div>
       </div>{/* ══ end 3-column grid ══ */}

        {/* Value-prop upsell — turn this 2D proof into a 3D render */}
        {hero && !proof.white_label_logo_url && (
          <div className="rounded-2xl overflow-hidden border border-gray-200 bg-white shadow-sm">
            <img
              src="/designpro-3d-banner.png"
              alt="DesignProAI™ — Prompt to Print Production"
              className="w-full h-auto object-cover"
              loading="lazy"
            />
            <div className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1 min-w-0">
                <h3 className="text-[17px] font-extrabold text-gray-900">See your wrap come to life in 3D ✨</h3>
                <p className="text-[13px] text-gray-600 mt-1 leading-relaxed">
                  Turn this flat 2D proof into a <strong className="text-gray-900">photorealistic 3D render on your actual vehicle</strong> — from every angle, true to life. Approve with total confidence and see exactly how it'll look installed.
                </p>
                <p className="text-[12px] text-gray-500 mt-2">
                  Just <span className="font-bold text-gray-900">$20</span> — or go unlimited with <span className="font-bold text-gray-900">RecreatePro X</span>.
                </p>
              </div>
              <a
                href="https://weprintwraps.com/cart/?add-to-cart=RECREATEPRO_3D&price=20"
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 inline-flex items-center justify-center h-12 px-6 rounded-xl text-white font-bold text-[15px] hover:brightness-110 transition"
                style={{ background: "linear-gradient(90deg,#3b82f6,#ec4899)" }}
              >
                Get my 3D render →
              </a>
            </div>
            {/* Example — what a 3D proof looks like (every angle) */}
            <div className="px-5 pb-5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Example · a real 3D proof from every angle</div>
              <img
                src="/recreatepro-3d-example.jpg"
                alt="DesignProAI 3D proof — every angle"
                className="w-full h-auto rounded-xl border border-gray-200"
                loading="lazy"
              />
            </div>
          </div>
        )}

        {/* Footer — co-brand line mirrors the header badge so the page
            opens and closes on the same identity. White-label customers
            get a clean shop-only footer with no ApprovePro reference. */}
        <div className="pt-2 text-[11px] text-center text-zinc-400 space-y-0.5">
          <p>Proof ID: {proof.proof_id.slice(0, 8)}…</p>
          {!proof.white_label_logo_url && (
            <p>
              Secure proof delivered by{" "}
              <span className="font-semibold">
                <span className="text-zinc-600">Approve</span>
                <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">Pro</span>
              </span>
              {" "}for {proof.shop_name || "your wrap shop"}
            </p>
          )}
        </div>
      </main>
        </div>{/* /content column */}
      </div>{/* /ApprovedPro shell grid */}

      {/* Revision request dialog — Phase 3 */}
      <RequestRevisionDialog
        open={showRevisionDialog}
        onOpenChange={setShowRevisionDialog}
        token={token!}
        onSuccess={() => {
          setShowRevisionDialog(false);
          setState({ kind: "revision_sent" });
        }}
      />

      {/* Customer revise — ACE robot is the DEFAULT live experience. The legacy
          tested text flow (<ReviseConversation>) is only the fallback, reached
          by adding ?ace=0 to the proof URL (aceRobot = searchParams !== "0"). */}
      {aceRobot ? (
        <AceRevisionRobot
          open={showAIReviseDialog}
          onOpenChange={setShowAIReviseDialog}
          token={token!}
          seedPrompt={reviseSeed}
          finish={proof.finish_type ?? null}
          vehicleMake={proof.vehicle?.make ?? null}
          vehicleModel={proof.vehicle?.model ?? null}
          onChanged={() => loadProof({ silent: true })}
          onApprove={() => {
            setShowAIReviseDialog(false);
            setTimeout(() => document.getElementById("proof-approve")?.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
          }}
          onMessageTeam={() => {
            setShowAIReviseDialog(false);
            setTimeout(() => setShowMessageTeam(true), 150);
          }}
        />
      ) : (
        <ReviseConversation
          open={showAIReviseDialog}
          onOpenChange={setShowAIReviseDialog}
          token={token!}
          onChanged={() => loadProof({ silent: true })}
          onApprove={() => {
            setShowAIReviseDialog(false);
            setTimeout(() => document.getElementById("proof-approve")?.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
          }}
          onMessageTeam={() => {
            setShowAIReviseDialog(false);
            setTimeout(() => setShowMessageTeam(true), 150);
          }}
        />
      )}

      {/* Customer ⇄ team messaging loop */}
      <MessageTeamDialog
        open={showMessageTeam}
        onOpenChange={setShowMessageTeam}
        token={token!}
        shopName={proof.shop_name}
      />

      {/* Decline dialog */}
      <Dialog open={showDeclineDialog} onOpenChange={setShowDeclineDialog}>
        <DialogContent>
          <DialogTitle>Decline this design</DialogTitle>
          <DialogDescription>
            Let the shop know why you're declining so they can follow up.
          </DialogDescription>
          <Textarea
            value={declineReason}
            onChange={(e) => setDeclineReason(e.target.value)}
            placeholder="Required: briefly describe what doesn't work for you…"
            className="min-h-[100px]"
            disabled={isSubmitting}
          />
          {submitError && (
            <p className="text-sm text-red-600">{submitError}</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setShowDeclineDialog(false);
                setSubmitError(null);
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDecline}
              disabled={isSubmitting || declineReason.trim().length < 3}
              variant="destructive"
            >
              {isSubmitting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting…</>
              ) : (
                "Submit decline"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Fullscreen zoom modal — image on top, actions underneath so the
          client can approve / decline / request revisions without closing. */}
      {/* 3D PROOF — the full multi-angle on-vehicle render set (not a single
          side). Tap any angle to enlarge. */}
      {show3D && (() => {
        const v3d = customerViews(proof);
        return (
          <div className="fixed inset-0 z-50 bg-black/90 flex flex-col p-4 sm:p-6 overflow-y-auto" onClick={() => setShow3D(false)}>
            <div className="flex items-center justify-between mb-3" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-white font-bold text-lg">3D Proof — {proof.design_name || "Your Design"} <span className="text-white/60 font-normal text-sm">({v3d.length} views)</span></h3>
              <button onClick={() => setShow3D(false)} className="bg-white/20 hover:bg-white/40 rounded-full p-2 text-white" aria-label="Close 3D proof">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" onClick={(e) => e.stopPropagation()}>
              {v3d.map((v) => (
                <button key={v.type} onClick={() => setZoomImage(v.url)} className="block rounded-lg overflow-hidden border border-white/15 bg-zinc-900 text-left">
                  <img src={v.url} alt={VIEW_LABELS[v.type] || v.type} loading="lazy" className="w-full aspect-video object-cover" />
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-white/80 px-2 py-1.5">{VIEW_LABELS[v.type] || v.type.replace(/-|_/g, " ")}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {zoomImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center gap-4 p-4 sm:p-6 overflow-y-auto"
          onClick={() => setZoomImage(null)}
        >
          <button
            onClick={() => setZoomImage(null)}
            className="absolute top-4 right-4 bg-white/20 hover:bg-white/40 rounded-full p-2 text-white transition-colors z-10"
            aria-label="Close enlarged view"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={zoomImage}
            alt="Enlarged view"
            className="max-w-full w-auto max-h-[calc(100vh-10rem)] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          {!["approved", "declined", "revoked", "expired"].includes(proof.status) && (
            <div
              className="flex flex-wrap items-center justify-center gap-2 w-full max-w-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <Button
                onClick={() => {
                  setZoomImage(null);
                  window.setTimeout(() => {
                    document.getElementById("sign-section")?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                  }, 80);
                }}
                className="h-11 px-5 text-sm font-semibold bg-gradient-to-r from-blue-500 to-indigo-600 hover:opacity-90 text-white border-0 shadow-lg"
              >
                <CheckCircle2 className="w-4 h-4 mr-2" />
                {hasLineItems ? "Sign & Finalize" : "Approve & Sign"}
              </Button>
              {!hasLineItems && (
                <Button
                  onClick={() => {
                    setZoomImage(null);
                    setShowDeclineDialog(true);
                  }}
                  variant="outline"
                  className="h-11 px-5 text-sm font-semibold bg-white hover:bg-white/90 border-zinc-300 shadow-lg"
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  Decline
                </Button>
              )}
              {!hasLineItems && proof.mode === "revision_loop" && (
                <Button
                  onClick={() => {
                    setZoomImage(null);
                    setShowRevisionDialog(true);
                  }}
                  variant="outline"
                  className="h-11 px-5 text-sm font-semibold bg-white hover:bg-blue-50 text-blue-700 border-blue-300 shadow-lg"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Request Revision
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
