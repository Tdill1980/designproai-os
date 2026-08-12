/**
 * ApprovePro — shop workbench.
 *
 * Route: /approvepro (RequireAuth)
 *
 * Two-pane layout:
 *   LEFT: scrollable list of every proof the shop has sent, with
 *         thumbnail, customer, status badge, vehicle summary, design
 *         name, filter chips + search.
 *   RIGHT: active-item detail card — enlarged hero image, customer
 *          context, shop-side action buttons (Open client page,
 *          Copy link, Resend, Revoke, Escalate to RestylePro Support,
 *          Push New Version), and an internal notes box the shop can
 *          save to proof_approvals.internal_notes.
 *
 * This is where Lance + the team live to process client approvals.
 * Replaces the earlier "marketing landing page" concept.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EscalateSupportDialog } from "@/components/proof/EscalateSupportDialog";
import { SendForApprovalDialog } from "@/components/proof/SendForApprovalDialog";
import { SendProofDialog } from "@/components/proof/SendProofDialog";
import { ProofProgressStepper } from "@/components/proof/ProofProgressStepper";
import { ProofUploadVersion } from "@/components/proof/ProofUploadVersion";
import { AttachDesignDialog } from "@/components/proof/AttachDesignDialog";
import { PullFromQCDialog } from "@/components/proof/PullFromQCDialog";
import { ProofSourceOfTruth } from "@/components/proof/ProofSourceOfTruth";
import { ProofIntakeHistory } from "@/components/proof/ProofIntakeHistory";
import { ProofValidationChecklist } from "@/components/proof/ProofValidationChecklist";
import { ProofProjectTimeline } from "@/components/proof/ProofProjectTimeline";
import { ProofVersionTimeline } from "@/components/proof/ProofVersionTimeline";
import { ProofRevisionThread } from "@/components/proof/ProofRevisionThread";
import { AiActionBar } from "@/components/proof/AiActionBar";
import { HoverZoomThumb } from "@/components/proof/HoverZoomThumb";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ChevronDown as ChevronDownIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { ProofViewsStrip } from "@/components/proof/ProofViewsStrip";
import { ProfessionalProofSheet } from "@/components/tools/ProfessionalProofSheet";
import { TwoDProofSheet } from "@/components/tools/TwoDProofSheet";
import { TeamMessagesPanel } from "@/components/proof/TeamMessagesPanel";
import { computeAgentState } from "@/lib/approvepro-agent-state";
import { classifyIntake, isCutContourFileOutputOrder } from "@/lib/approvepro-brief";
import { ProofIntakeStatus } from "@/components/proof/ProofIntakeStatus";
import { ApproveProAnalyticsCards } from "@/components/proof/ApproveProAnalyticsCards";
import { ApproveProAgentChat } from "@/components/proof/ApproveProAgentChat";
import { AssigneeAvatar } from "@/components/proof/AssigneeAvatar";
import { AssignProofControl } from "@/components/proof/AssignProofControl";
import { DesignTabEmbed } from "@/components/proof/DesignTabEmbed";
import { DesignAssetsPanel } from "@/components/proof/DesignAssetsPanel";
import { RevisionProgress } from "@/components/proof/RevisionProgress";
import { CutContourPanel } from "@/components/proof/CutContourPanel";
import { CutGraphicsProofCard } from "@/components/proof/CutGraphicsProofCard";
import { LiftedAssetsCards } from "@/components/proof/LiftedAssetsCards";
import { WorkOrderSheet } from "@/components/wpw/WorkOrderSheet";
import { lineItemsAreDesignOrder, nameLooksLikeDesignOrder, lineItemsAreCustomWrapDesign } from "@/lib/wpw-design-products";
import { useWpwOrder, type WpwOrder } from "@/hooks/useWpwOrders";
import { stashOrderForPrint } from "@/lib/wpw-print-stash";
import { useShopTeam } from "@/hooks/useShopTeam";
import { isWpwInternalStaffMember } from "@/lib/admin-allowlist";
import { enticePanelsFromProof } from "@/lib/enticePanelsFromProof";
import {
  ClipboardSignature, Search, RefreshCw, ExternalLink, Send, Copy, XCircle,
  Loader2, Eye, CheckCircle2, Clock, AlertTriangle, RotateCw, LifeBuoy, Package,
  Save, FileText, Mail, User, Car as CarIcon, ImageIcon, MessageSquare, Reply, Plus, Link2, Sparkles, Info, Download, Printer, UserCheck, CalendarDays, Upload, Rocket, X, Paperclip, Mic, Square, Layers, Trash2,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type ProofStatus =
  | "draft" | "sent" | "viewed" | "revising" | "approved" | "declined"
  | "revoked" | "expired" | "delivery_failed" | "escalated_shop" | "escalated_support";

interface ProofRow {
  id: string;
  view_token: string;
  manage_token: string;
  customer_name: string | null;
  customer_email: string;
  customer_phone: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  design_name: string | null;
  finish_type: string | null;
  mode: string;
  status: ProofStatus;
  has_line_items: boolean | null;
  message_to_customer: string | null;
  internal_notes: string | null;
  expires_at: string | null;
  sent_at: string | null;
  signed_at: string | null;
  decline_reason: string | null;
  change_request: string | null;
  ai_revisions_used: number;
  ai_revisions_allowed: number;
  metadata: Record<string, any> | null;
  assigned_to: string | null;
  assigned_at: string | null;
  assigned_by: string | null;
  source_visualization_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ProofLineItemRow {
  id: string;
  line_number: number;
  title: string;
  description: string | null;
  render_url: string | null;
  status: "pending" | "approved" | "declined" | "revising";
  decline_reason: string | null;
  change_request: string | null;
}

interface ActiveVersion {
  id: string;
  version_number: number;
  created_by_role: string;
  render_urls: Record<string, string>;
  uploaded_file_paths: string[];
  created_at: string;
}

const STATUS: Record<ProofStatus, { label: string; color: string; icon: typeof Send }> = {
  draft:             { label: "Draft",       color: "bg-gray-100 text-gray-600 border-gray-200", icon: ClipboardSignature },
  sent:              { label: "Sent",        color: "bg-blue-100 text-blue-700 border-blue-200", icon: Send },
  viewed:            { label: "Viewed",      color: "bg-blue-100 text-blue-700 border-blue-200", icon: Eye },
  revising:          { label: "Revising",    color: "bg-purple-100 text-purple-700 border-purple-200", icon: RotateCw },
  approved:          { label: "Approved",    color: "bg-green-100 text-green-700 border-green-200", icon: CheckCircle2 },
  declined:          { label: "Declined",    color: "bg-red-100 text-red-700 border-red-200", icon: XCircle },
  revoked:           { label: "Revoked",     color: "bg-zinc-100 text-gray-700 border-gray-200", icon: XCircle },
  expired:           { label: "Expired",     color: "bg-zinc-100 text-gray-700 border-gray-200", icon: Clock },
  delivery_failed:   { label: "Email failed", color: "bg-red-100 text-red-700 border-red-200", icon: AlertTriangle },
  escalated_shop:    { label: "Shop revising", color: "bg-amber-100 text-amber-700 border-amber-200", icon: RotateCw },
  escalated_support: { label: "Support",     color: "bg-amber-100 text-amber-700 border-amber-200", icon: LifeBuoy },
};

// Action-first triage lanes. "Needs You" = the ball is in the SHOP's court
// (draft not sent, customer asked for a revision, customer declined, a send
// failed, or it was escalated) — everything a designer must act on. "Awaiting"
// = sent/viewed, waiting on the customer. "Done" = approved. This split is the
// whole point of the workbench: at a glance, what's mine to move forward.
type FilterKey = "needs_you" | "awaiting" | "done" | "all";
const FILTERS: Array<{ key: FilterKey; label: string; statuses?: ProofStatus[] }> = [
  { key: "needs_you", label: "Needs You", statuses: ["draft", "revising", "declined", "delivery_failed", "escalated_shop", "escalated_support"] },
  { key: "awaiting",  label: "Awaiting",  statuses: ["sent", "viewed"] },
  { key: "done",      label: "Done",      statuses: ["approved"] },
  { key: "all",       label: "All" },
];

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = 60_000;
  const h = 60 * m;
  const day = 24 * h;
  if (diff < m) return "just now";
  if (diff < h) return `${Math.floor(diff / m)}m ago`;
  if (diff < day) return `${Math.floor(diff / h)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Absolute timestamp for handoff scenarios — a designer reviewing the
// proof days/weeks later needs the exact date + time, not "2d ago".
function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Human-readable text for one correspondence/thread event. Centralized so the
// inline thread and the Correspondence tab render identically. Handles
// line_item_decision (per-panel customer revision requests) — those carry the
// feedback in payload.note + line_title, and were previously not rendered, so
// a customer who only requested changes per-panel looked like they "never
// responded" even though their feedback was in history.
function threadEventMessage(ev: any): string {
  const p = ev?.payload || {};
  if (ev?.event_type === "line_item_decision") {
    const where = p.line_title ? ` on ${p.line_title}` : "";
    const note = p.note ? `: "${p.note}"` : "";
    const verb =
      p.decision === "approve" ? "Approved" :
      p.decision === "decline" ? "Declined" :
      "Requested revision";
    return `${verb}${where}${note}`;
  }
  return p.message || p.change_request || p.decline_reason ||
    (ev?.event_type === "instructions_requested" ? "Requested design instructions & artwork from the customer." :
     ev?.event_type === "sent" ? "Proof sent to customer" :
     ev?.event_type === "resent" ? "Proof re-sent to customer" :
     ev?.event_type === "signed" ? "Customer signed the proof" :
     ev?.event_type === "declined" ? `Customer declined${p.reason ? `: ${p.reason}` : ""}` :
     ev?.event_type === "revision_requested" ? "Customer requested a revision" :
     ev?.event_type);
}

// Instruction card, rebuilt as a CAROUSEL. Slides = the customer's recent
// edits & messages (newest first) followed by the original written
// instruction, each stamped with date + time. Opens on the latest activity so
// a designer sees the most recent customer feedback the moment they open the
// job — no sub-tab digging. Each slide's message is fully readable and has a
// one-click COPY, plus any attachments the customer sent. Pure presentation:
// takes the same replyEvents the rest of the workbench already loads.
function InstructionCarousel({
  instruction,
  instructionDate,
  events,
  customerName,
  headerBg,
}: {
  instruction: string;
  instructionDate: string | null;
  events: Array<{ event_type: string; actor_role: string; payload: any; created_at: string }>;
  customerName: string | null;
  headerBg: string;
}) {
  const isCustomerEdit = (et: string) =>
    ["customer_reply", "customer_comment", "revision_requested", "line_item_decision"].includes(et);

  // Edit/message slides, newest first. CRITICAL: drop `version_saved` (those are
  // system autogen render-bookkeeping events that render as the meaningless
  // text "version saved" and were BURYING the customer's real, readable
  // messages) plus pure delivery noise (email_sent / send_failed).
  const HIDE = new Set(["version_saved", "email_sent", "send_failed"]);
  const activitySlides = (events || [])
    .filter((e) => !HIDE.has(e.event_type))
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .map((ev) => {
      const fromCustomer = ev.actor_role === "customer" || isCustomerEdit(ev.event_type);
      const att = Array.isArray(ev?.payload?.attachments) ? (ev.payload.attachments as string[]) : [];
      return {
        kind: fromCustomer ? ("customer" as const) : ("shop" as const),
        label: fromCustomer
          ? (isCustomerEdit(ev.event_type) ? `${customerName || "Customer"} edit` : `${customerName || "Customer"} message`)
          : "Shop message",
        text: threadEventMessage(ev),
        date: ev.created_at as string | null,
        attachments: att,
      };
    });

  // Original written instruction lives at the END (oldest), so the carousel
  // opens on the newest edit/message but the brief is always one swipe away.
  const slides = [
    ...activitySlides,
    ...(instruction && instruction.trim()
      ? [{ kind: "instruction" as const, label: "Original instruction", text: instruction, date: instructionDate, attachments: [] as string[] }]
      : []),
  ];

  const [idx, setIdx] = useState(0);
  const [copied, setCopied] = useState(false);

  if (slides.length === 0) {
    return (
      <>
        <div className="px-2.5 py-1 text-white text-[10px] font-bold uppercase tracking-wider" style={{ background: headerBg }}>
          Instruction:
        </div>
        <div className="px-2.5 py-1.5 bg-white max-h-32 overflow-y-auto">
          <p className="text-[11px] text-gray-400 italic">No written instructions yet — press GO to email the customer a portal link.</p>
        </div>
      </>
    );
  }

  const safeIdx = Math.min(idx, slides.length - 1);
  const cur = slides[safeIdx];
  const labelTone =
    cur.kind === "customer" ? "text-pink-100" :
    cur.kind === "shop" ? "text-cyan-100" :
    "text-white/80";

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(cur.text || "");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — no-op */ }
  };

  return (
    <>
      {/* Header bar: label of the CURRENT slide + copy + counter + prev/next */}
      <div className="px-2.5 py-1 text-white flex items-center justify-between gap-2" style={{ background: headerBg }}>
        <span className="text-[10px] font-bold uppercase tracking-wider truncate">
          Instruction <span className={`font-semibold normal-case ${labelTone}`}>· {cur.label}</span>
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={copyText}
            className="h-4 px-1 inline-flex items-center gap-0.5 rounded bg-white/15 hover:bg-white/30 transition-colors text-[9px] font-semibold"
            aria-label="Copy message"
            title="Copy this message"
          >
            <Copy className="w-2.5 h-2.5" />
            {copied ? "Copied" : "Copy"}
          </button>
          <span className="text-[9.5px] font-semibold text-white/85 tabular-nums">{safeIdx + 1}/{slides.length}</span>
          {slides.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => { setCopied(false); setIdx((i) => (Math.min(i, slides.length - 1) - 1 + slides.length) % slides.length); }}
                className="h-4 w-4 inline-flex items-center justify-center rounded bg-white/15 hover:bg-white/30 transition-colors"
                aria-label="Previous"
                title="Previous"
              >
                <ChevronLeft className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => { setCopied(false); setIdx((i) => (Math.min(i, slides.length - 1) + 1) % slides.length); }}
                className="h-4 w-4 inline-flex items-center justify-center rounded bg-white/15 hover:bg-white/30 transition-colors"
                aria-label="Next"
                title="Next"
              >
                <ChevronRight className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
      </div>
      {/* Slide body: full readable message + attachments + date/time stamp */}
      <div className="px-2.5 py-1.5 bg-white max-h-36 overflow-y-auto">
        <p className="text-[11.5px] text-gray-900 whitespace-pre-wrap leading-snug select-text">{cur.text}</p>
        {cur.attachments.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {cur.attachments.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noreferrer" title="Open attachment" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 text-[10px] text-blue-700 hover:bg-blue-100">
                <Paperclip className="w-2.5 h-2.5" />
                Attachment {i + 1}
              </a>
            ))}
          </div>
        )}
        {cur.date && (
          <p className="mt-1 text-[10px] text-gray-400">{formatAbsolute(cur.date)} · {formatRelative(cur.date)}</p>
        )}
      </div>
    </>
  );
}

// Repeated WPW order syncs create several proof rows for the same order,
// which splits a customer's history across duplicates and lands the shop on
// empty rows. Collapse them: keep the most meaningful proof per order —
// prefer activity (line items, already sent, non-draft), then most recently
// updated. Non-destructive: hidden duplicates still exist in the database.
// Browse-by-month helpers. A job's date is the WooCommerce order date when
// we have it (metadata), else the proof's created_at (when it entered the
// queue). Key is "YYYY-MM" for stable grouping; label is "Jun 2026".
function orderDateRaw(r: any): string | null {
  // Authoritative WooCommerce order date first (older synced rows carry it as
  // woo_date_created), then other order-date stamps, then the proof's
  // created_at as a last resort (when it entered the queue).
  const m = r?.metadata || {};
  return m.woo_date_created || m.wpw_order_date || m.date_created || r?.created_at || null;
}
function rowOrderDate(r: any): string | null {
  // __order_date is stamped by dedupeByOrder = the earliest real order date
  // across the order's duplicate rows, so a May-backfilled survivor still
  // reports its true (e.g. April) order date for the month browse + at-a-glance.
  return r?.__order_date || orderDateRaw(r);
}
function orderTotalRaw(r: any): string | null {
  const m = r?.metadata || {};
  return m.woo_order_total || m.wpw_order_total || m.order_total || m.total || null;
}
function rowOrderTotal(r: any): number | null {
  // __order_total is stamped by dedupeByOrder from whichever duplicate row
  // carries the WooCommerce total (the May-backfilled survivor often lacks it).
  const raw = r?.__order_total ?? orderTotalRaw(r);
  if (raw == null) return null;
  const n = Number(raw);
  return isNaN(n) ? null : n;
}
function monthKey(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function orderKeyOf(r: any): string | null {
  const m = r?.metadata || {};
  const k = m.wpw_order_number || m.wpw_woo_order_id || m.woo_order_number;
  return k != null && String(k).trim() ? String(k).trim() : null;
}
// "Custom Wrap Design orders only" = the Custom Vehicle Wrap Design product
// (WooCommerce IDs 234 / 58160), recognized DETERMINISTICALLY by product id —
// NOT Design Setup/File Output (289) or Hourly Design (290), which also contain
// the word "design". Source of truth lives in wpw-design-products.ts. Falls
// back to SKU/name for proofs synced before product_id was persisted.
// A proof belongs in the ApprovePro queue only when it is BOTH a real
// WePrintWraps WooCommerce order (auto-ingested, carries wpw_woo_order_id —
// NOT an internally-generated RP- proof) AND one of the paid design products
// (Custom/Full Wrap Design 234/58160, Hourly Design 290, Design Setup/Output
// 289). This keeps the queue to genuine WPW design orders and excludes both
// RestylePro test/internal proofs and pure print/material orders.
function isRealWpwOrder(r: any): boolean {
  // Strict: only orders the WPW sync ingested (auto_ingested === "wpw", the
  // purple WPW badge). RestylePro-generated proofs (RP-#### in
  // wpw_order_number, auto_ingested null) are NOT real WPW orders and must
  // never enter the design queue.
  return r?.metadata?.auto_ingested === "wpw";
}
function isDesignOrder(r: any): boolean {
  if (!isRealWpwOrder(r)) return false;
  return lineItemsAreDesignOrder(r?.metadata?.line_items) ||
    // Last-resort fallback for rows with no cached line items at all.
    (!Array.isArray(r?.metadata?.line_items) && nameLooksLikeDesignOrder(r?.design_name));
}
function dedupeByOrder(rows: any[]): any[] {
  // Dead rows (a WPW order can sync several times, auto-revoking the older
  // copies) must LOSE to any live row, or the workbench shows/acts on a revoked
  // duplicate — GO then reports "order is revoked, nothing to do" even though a
  // designable draft exists. approved/sent are GOOD non-draft states and still win.
  const DEAD = new Set(["revoked", "expired", "declined"]);
  const score = (r: any) =>
    (r.has_line_items ? 4 : 0) +
    (r.sent_at ? 2 : 0) +
    (DEAD.has(r.status) ? -100 : (r.status && r.status !== "draft" ? 1 : 0));
  // Group every row by order so we can both pick the winner AND recover the
  // true order date from whichever duplicate carries it.
  const groups = new Map<string, any[]>();
  for (const r of rows) {
    const key = orderKeyOf(r);
    if (!key) continue; // native (non-order) proofs are never collapsed
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const winners = new Set<any>();
  for (const group of groups.values()) {
    let win = group[0];
    for (const r of group) {
      const better = score(r) !== score(win)
        ? score(r) > score(win)
        : new Date(r.updated_at).getTime() > new Date(win.updated_at).getTime();
      if (better) win = r;
    }
    // Stamp the winner with the earliest real order date across the group so
    // a May-backfilled survivor still browses/sorts under its true month.
    const times = group
      .map((r) => orderDateRaw(r))
      .filter(Boolean)
      .map((d) => new Date(d as string).getTime())
      .filter((t) => !isNaN(t));
    if (times.length) win.__order_date = new Date(Math.min(...times)).toISOString();
    // Carry the order total from whichever duplicate has it.
    const total = group.map((r) => orderTotalRaw(r)).find((v) => v != null);
    if (total != null) win.__order_total = total;
    winners.add(win);
  }
  return rows.filter((r) => orderKeyOf(r) == null || winners.has(r));
}

// Cross-origin downloads (WPW images live on weprintwraps.com) ignore
// the <a download> attribute — the browser opens the file in a new tab
// instead of saving it. Fetching as a Blob and triggering an object-URL
// download is the only way to make "Save image" reliable across hosts.
async function downloadFile(url: string, filenameHint?: string): Promise<void> {
  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filenameHint || (() => {
      try { return decodeURIComponent(new URL(url).pathname.split("/").pop() || "download"); }
      catch { return "download"; }
    })();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    // Cross-origin without CORS — fall back to opening in a new tab so
    // the designer can right-click → Save As.
    window.open(url, "_blank", "noopener");
  }
}

function heroUrl(v: ActiveVersion | null): string | null {
  if (!v) return null;
  return v.render_urls?.hero || v.render_urls?.side || v.render_urls?.roof ||
    Object.values(v.render_urls || {})[0] || v.uploaded_file_paths?.[0] || null;
}
// The 2D Production Proof (dimensioned multi-view sheet A.C.E auto-generates) is
// the SOURCE for rectangle print-file creation — prefer it when sending to
// production so the panelizer builds panels from the approved proof, not a 3D
// render. Falls back to the hero render only if no 2D proof exists yet.
function productionProofUrl(v: ActiveVersion | null): string | null {
  if (!v) return null;
  return (v.render_urls as any)?.production_proof || (v.render_urls as any)?.proof_2d || heroUrl(v);
}
// A REAL render WE made — never a weprintwraps.com URL (those are the
// customer's own uploaded art via WooCommerce extra-product-options, or the
// stock product thumbnail). Those belong in the Work Order as references, not
// as "our proof". Returns null when we haven't actually designed anything yet.
function realRenderUrl(v: ActiveVersion | null): string | null {
  if (!v) return null;
  const renders = Object.values(v.render_urls || {})
    .filter((u) => typeof u === "string" && u && !u.includes("weprintwraps.com")) as string[];
  if (renders.length) return renders[0];
  if (v.uploaded_file_paths?.length) return v.uploaded_file_paths[0];
  return null;
}

function getPublicBase(): string {
  return typeof window !== "undefined" ? window.location.origin : "https://restyleproai.com";
}

export default function ApproveProPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [rows, setRows] = useState<ProofRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("needs_you");
  // CHWD lane — narrow the (design-orders-only) queue to the Custom Vehicle
  // Wrap Design product (Woo 234/58160, SKU CHWD): the full-wrap design jobs
  // that drive the recreate/print pipeline, separated from Hourly Design and
  // Output-fee lines. Orthogonal to the status tabs above.
  const [chwdOnly, setChwdOnly] = useState(false);
  // Analytics card drill-down: narrows the list to a card's matching orders.
  const [analyticsDrill, setAnalyticsDrill] = useState<{ key: string; label: string } | null>(null);
  const [search, setSearch] = useState("");
  // Browse the queue by the month a job came in (so old WooCommerce orders
  // are reachable, not just recent ones). "all" = no month constraint.
  const [monthFilter, setMonthFilter] = useState<string>("all");
  // Default ON: ApprovePro (WePrintWraps) is the design-proof queue, so the
  // default view is ALL Custom Wrap Design orders. Uncheck to also see
  // printing/material/other jobs.
  // ApprovePro is permanently scoped to real WPW design orders (enforced in
  // `filtered`/`countBase` via isDesignOrder) — no user-facing toggle.
  // "Attach a design you made" picker (links an RP design to this order's proof).
  const [attachOpen, setAttachOpen] = useState(false);
  // "Import correct design from Revision Studio" — paste a link/UUID to set it
  // as this proof's active version (uses the SAME proof-save-version mechanism
  // as AttachDesignDialog, so it works under RLS for admins).
  const [importOpen, setImportOpen] = useState(false);
  const [importInput, setImportInput] = useState("");
  const [importing, setImporting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("id") || null);
  // Which proof-view thumbnail is shown as the big proof (mockup-style swap).
  const [heroOverrideUrl, setHeroOverrideUrl] = useState<string | null>(null);
  // ProductionFlow-style detail tabs.
  const [detailTab, setDetailTab] = useState<"workorder" | "design" | "truth">("workorder");
  const detailRef = useRef<HTMLElement | null>(null);
  // Reset the chosen view whenever the selected order changes.
  useEffect(() => { setHeroOverrideUrl(null); }, [selectedId]);

  // "Give A.C.E context" — the operator can type instructions + drop the
  // customer's art right on the work order, then press GO. Uploads route the
  // job to RecreatePro (recreate faithfully); text-only routes to DesignPro
  // (design fresh). A.C.E decides from whatever is provided.
  const [aceBrief, setAceBrief] = useState("");
  // Voice → text for the A.C.E hero: record a clip, transcribe via ace-transcribe
  // (Whisper) using this order's view token, drop the transcript into the brief.
  const [aceRecording, setAceRecording] = useState(false);
  const [aceTranscribing, setAceTranscribing] = useState(false);
  const [aceMicError, setAceMicError] = useState<string | null>(null);
  const aceRecRef = useRef<MediaRecorder | null>(null);
  const aceChunksRef = useRef<Blob[]>([]);
  const toggleAceMic = async () => {
    setAceMicError(null);
    if (aceRecording) { aceRecRef.current?.stop(); return; }
    const tok = selected?.view_token;
    if (!tok) { setAceMicError("Open an order first."); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setAceMicError("Voice input isn't supported on this browser."); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      aceChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) aceChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setAceRecording(false);
        const blob = new Blob(aceChunksRef.current, { type: mr.mimeType || "audio/webm" });
        if (blob.size < 800) return;
        setAceTranscribing(true);
        try {
          const b64: string = await new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = () => res((r.result as string).replace(/^data:[^,]+,/, ""));
            r.onerror = () => rej(new Error("read failed"));
            r.readAsDataURL(blob);
          });
          const { data } = await supabase.functions.invoke("ace-transcribe", { body: { token: tok, audio_base64: b64, mime: blob.type } });
          const text = ((data as any)?.text || "").trim();
          if (text) setAceBrief((prev) => (prev ? prev.trim() + " " : "") + text);
          else setAceMicError("Didn't catch that — try again.");
        } catch { setAceMicError("Couldn't transcribe — try again."); }
        finally { setAceTranscribing(false); }
      };
      aceRecRef.current = mr; mr.start(); setAceRecording(true);
    } catch { setAceMicError("Mic access denied. Allow the microphone to talk to A.C.E."); }
  };
  const [aceUploading, setAceUploading] = useState(false);
  const aceFileInputRef = useRef<HTMLInputElement | null>(null);
  // Drives the floating A.C.E chat's external open (Command-Header "Revise"
  // button): bump the signal to open it, seed the input to prompt A.C.E direct.
  const [aceOpenSignal, setAceOpenSignal] = useState(0);
  const [aceSeed, setAceSeed] = useState("");
  const openAceRevise = () => {
    setAceSeed("Revise the current design: ");
    setAceOpenSignal((s) => s + 1);
  };

  // Team scope — who's on this shop, who's the current user, and the
  // per-proof "last viewed" map that drives the NEW badge.
  // `assigneeFilter` is "all" (default), "mine", "unassigned", or a user_id.
  const team = useShopTeam();
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [teamViews, setTeamViews] = useState<Record<string, string>>({}); // proof_id → last_viewed_at ISO

  // Designer scoping: the whole WPW internal staff team (Trish, tdill,
  // Lance, Troy, Carley, Jackson, Brice, Amanda) sees the FULL queue —
  // every WPW design job, regardless of who it's assigned to — exactly
  // like OrdersPro shows every order to all internal staff. Only outside
  // contract designers (not on the internal-staff allowlist) are scoped
  // down to ONLY the proofs assigned to them, so their ApprovePro is a
  // personal work queue rather than the firehose.
  const currentUserEmail = team.members.find((m) => m.isCurrentUser)?.email ?? null;
  const designerScoped =
    !team.isLoading && !!currentUserEmail && !isWpwInternalStaffMember(currentUserEmail);

  // Sync selectedId FROM the URL ?id= param on initial mount only. Sidebar
  // rails (QcJobsRail / WpwOrdersRail) set selection via direct state callbacks,
  // and the state→URL effect below writes the URL out when selectedId changes,
  // so a one-time mount read covers deep links / refresh without setting up a
  // feedback channel that re-fires every time the URL changes.
  useEffect(() => {
    const urlId = searchParams.get("id");
    if (urlId && urlId !== selectedId) {
      setSelectedId(urlId);
    }
    // mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On mobile (single-column layout), the detail card sits well below
  // the rails + filter list, so tapping a proof in any rail makes it
  // look like nothing happened. Scroll the detail card into view when
  // selectedId changes on small screens. Desktop split-pane keeps
  // both panes visible so we leave that alone.
  useEffect(() => {
    if (!selectedId) return;
    if (typeof window === "undefined") return;
    if (window.innerWidth >= 1024) return;
    const el = detailRef.current;
    if (!el) return;
    // Defer one frame so React has finished rendering the detail card.
    requestAnimationFrame(() => {
      // Only scroll when the detail is actually off-screen. Smooth-scrolling
      // on every tap (even when it's already visible) reads as the whole
      // page "shaking" — and a second tap mid-animation makes it worse. A
      // one-shot instant jump only when needed keeps it calm.
      const rect = el.getBoundingClientRect();
      if (rect.top >= 0 && rect.top < window.innerHeight * 0.6) return;
      el.scrollIntoView({ behavior: "auto", block: "start" });
    });
  }, [selectedId]);
  const [activeVersion, setActiveVersion] = useState<ActiveVersion | null>(null);
  const [lineItemRows, setLineItemRows] = useState<ProofLineItemRow[]>([]);
  const [notesDraft, setNotesDraft] = useState("");
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [customerNameDraft, setCustomerNameDraft] = useState("");
  const [customerEmailDraft, setCustomerEmailDraft] = useState("");
  const [customerPhoneDraft, setCustomerPhoneDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [messageDraft, setMessageDraft] = useState("");
  const [savingMessage, setSavingMessage] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  // Manual "Choose an action" → opens a preview/confirm dialog showing exactly
  // what will be sent before it fires. Holds the chosen action key.
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [showEscalate, setShowEscalate] = useState(false);
  const [showReply, setShowReply] = useState(false);
  // Exact-email viewer (the HTML the customer actually received), opened from
  // the Messages thread so "what was sent" is visible where you'd look.
  const [emailHtmlView, setEmailHtmlView] = useState<string | null>(null);
  const [showNewProof, setShowNewProof] = useState(false);
  const [showPullFromQC, setShowPullFromQC] = useState(false);
  const [replyMessage, setReplyMessage] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [draftingReply, setDraftingReply] = useState(false);
  const [replyEvents, setReplyEvents] = useState<Array<{ event_type: string; actor_role: string; payload: any; created_at: string }>>([]);
  const [timelineRefreshKey, setTimelineRefreshKey] = useState(0);
  const [thumbMap, setThumbMap] = useState<Record<string, string>>({});
  // Track which proof ids we've already fetched a thumbnail for so the
  // thumbnails effect below doesn't re-fetch the whole queue every time
  // `rows` gets a new identity (loadList refresh, save handlers, optimistic
  // prepend). Without this, opening a job from the Orders rail kicked off
  // multiple 400+ row thumbnail refetches that re-rendered the entire rail.
  const thumbFetchedRef = useRef<Set<string>>(new Set());
  const [allVersions, setAllVersions] = useState<Array<{ id: string; version_number: number; created_by_role: string; is_active: boolean; created_at: string; render_urls?: Record<string, string>; uploaded_file_paths?: string[]; prompt_text?: string | null }>>([]);
  // Design Assets 💰 — the sellable single-source layers for the order (clean
  // background + transparent element PNGs the lift cut from the master artboard),
  // loaded from design_generation_assets by the same generation_id the 3D +
  // Production Pack use.
  const [designAssets, setDesignAssets] = useState<{ background_url?: string | null; overlay_pngs?: any[] } | null>(null);
  // Admin per-view edit (delete a mislabeled / wrong-angle render) — busy key.
  const [viewBusyKey, setViewBusyKey] = useState<string | null>(null);
  // Whole-proof delete (one row, or every shown row) — busy flag for the toolbar.
  const [deletingProofs, setDeletingProofs] = useState(false);
  // Per-view MANUAL upload — busy key (the view we're currently uploading onto),
  // reuses the same "upload:" prefix so it can't collide with viewBusyKey.
  const [uploadViewKey, setUploadViewKey] = useState<string | null>(null);
  // "2D Proof" composer (WePrintWraps-branded, deterministic) — busy flag.
  const [proof2dBusy, setProof2dBusy] = useState(false);
  // Design Assets proof viewer — tabbed (2D proof / 3D proof / 7 angles), no stacking.
  const [assetTab, setAssetTab] = useState<"2d" | "3d" | "angles">("2d");
  // "3D Proof" viewer — opens the formatted multi-angle Design Approval gallery
  // (same ProfessionalProofSheet RevisionStudio uses).
  const [show3DProofSheet, setShow3DProofSheet] = useState(false);
  // "2D Proof" viewer — the dimensioned production-proof sheet (logo + dimension
  // arrows), the SAME TwoDProofSheet RevisionStudio renders.
  const [show2DProofSheet, setShow2DProofSheet] = useState(false);
  // Send-proof composer — message + AI polish + choose what's on the portal.
  const [sendProofOpen, setSendProofOpen] = useState(false);
  // EMBEDDED RevisionStudio — the surgical AI editor opens IN PLACE here
  // (full-screen overlay with a same-origin iframe) instead of navigating away.
  // Same origin = it reuses this logged-in session (no re-login). When the editor
  // saves a new version it postMessages back so we close + refresh without a
  // page bounce. "Teach a man to fish": editing lives inside the workbench.
  const [editorUrl, setEditorUrl] = useState<string | null>(null);
  // Production Artboard Sheet composer (Summit-grade print spec) — busy flag.
  const [prodSheetBusy, setProdSheetBusy] = useState(false);
  // Flat master artboard generator (flattens the 2D proof → print panels) — busy.
  const [artboardBusy, setArtboardBusy] = useState(false);
  // Right-rail Proof Views carousel — which view is shown.
  const [proofRailIdx, setProofRailIdx] = useState(0);
  // Wipe-all-versions (admin "start fresh") — busy flag.
  const [wiping, setWiping] = useState(false);

  const loadList = async () => {
    setLoading(true);

    // Gate on a *synchronously* readable session, not on getUser(). getUser()
    // can stall for seconds on cross-tab auth-lock contention, which used to
    // leave the whole queue stuck on a spinner (the "Carley can't see the
    // list" bug). The proof query below is scoped by RLS using the JWT that
    // supabase-js attaches automatically, so we don't need the user object to
    // render the list.
    let hasSession = false;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("sb-") && k.endsWith("-auth-token") && localStorage.getItem(k)) {
          hasSession = true;
          break;
        }
      }
    } catch { /* privacy mode */ }
    if (!hasSession) {
      navigate("/login?redirect=/approvepro");
      return;
    }

    // Auto-ingest WPW design orders into proof_approvals as drafts so every
    // WooCommerce design job lands in the queue automatically. Fire-and-forget:
    // the 404 existing proofs render immediately regardless, and any freshly
    // ingested rows show on the next refresh. Never let a slow sync block the
    // list.
    supabase.functions.invoke("approvepro-sync-wpw", { body: {} }).catch((e) => {
      console.warn("approvepro-sync-wpw: non-fatal", e);
    });

    // Team-scoped query — RLS widens this to every proof on every shop the
    // caller's team belongs to via proof_shop_shared_team(shop_id). No explicit
    // shop_id filter so the whole team sees the same queue (WPW Woo orders AND
    // RestyleProAI-native jobs), each tagged by origin in the rail.
    const { data, error } = await supabase
      .from("proof_approvals" as any)
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error) {
      toast({ title: "Failed to load proofs", description: error.message, variant: "destructive" });
      setRows([]);
    } else {
      setRows(dedupeByOrder((data || []) as any[]) as unknown as ProofRow[]);
    }
    setLoading(false);

    // Best-effort: resolve the user for the "last viewed" anchors (drives the
    // NEW pulse). Bounded so a stalled auth lock can never block the list above.
    try {
      const userRes = await Promise.race([
        supabase.auth.getUser(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
      ]);
      const user = (userRes as any)?.data?.user;
      if (user) {
        const { data: views } = await (supabase as any)
          .from("proof_team_views")
          .select("proof_id, last_viewed_at")
          .eq("user_id", user.id);
        const map: Record<string, string> = {};
        for (const v of (views || []) as Array<{ proof_id: string; last_viewed_at: string }>) {
          map[v.proof_id] = v.last_viewed_at;
        }
        setTeamViews(map);
      }
    } catch (e) {
      console.warn("proof_team_views: non-fatal", e);
    }
  };

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Phase 2: auto-design new Custom Wrap Design orders ──
  // For each RECENTLY-synced (last 6h) real WPW Custom/Full Wrap Design draft
  // that has no design yet, kick off approvepro-autogen-design once. The 6h
  // window scopes this to genuinely-new orders (so we never mass-render the
  // back catalog), and the server claims each proof atomically so concurrent
  // staff sessions can't double-fire/double-bill. Fires sequentially, capped.
  const autogenFiredRef = useRef<Set<string>>(new Set());
  // AUTO-DESIGN DISABLED (Trish) — A.C.E no longer auto-generates designs on new
  // orders. A design is created ONLY when staff explicitly clicks GO / Regenerate.
  // Flip AUTO_DESIGN_ENABLED back to true to restore auto-generation.
  const AUTO_DESIGN_ENABLED = false;
  useEffect(() => {
    if (!AUTO_DESIGN_ENABLED) return;
    if (!rows || !team.currentUserId) return;
    const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
    const needs = rows.filter((r: any) =>
      r?.metadata?.auto_ingested === "wpw" &&
      r.status === "draft" &&
      !r.source_visualization_id &&
      !r?.metadata?.autogen_status &&
      lineItemsAreCustomWrapDesign(r?.metadata?.line_items) &&
      new Date(r.created_at).getTime() >= sixHoursAgo &&
      !autogenFiredRef.current.has(r.id)
    );
    if (needs.length === 0) return;
    (async () => {
      for (const p of needs.slice(0, 8)) {
        autogenFiredRef.current.add(p.id);
        try {
          await supabase.functions.invoke("approvepro-autogen-design", { body: { proof_id: p.id } });
        } catch (e) {
          // non-fatal — proof stays a draft for manual design
          console.warn("autogen invoke failed", e);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, team.currentUserId]);

  // Fetch thumbnails ONLY for proofs we haven't already fetched. Without the
  // ref guard, every `rows` identity change (loadList, save, prepend) refetched
  // all ~400 active versions and rebuilt the whole thumbMap → re-rendered the
  // entire rail twice per Open Workbench click, contributing to the blink.
  useEffect(() => {
    if (!rows || rows.length === 0) return;
    const missing = rows.map((r) => r.id).filter((id) => !thumbFetchedRef.current.has(id));
    if (missing.length === 0) return;
    for (const id of missing) thumbFetchedRef.current.add(id);
    (async () => {
      const { data } = await supabase
        .from("proof_versions" as any)
        .select("proof_id, render_urls, uploaded_file_paths")
        .in("proof_id", missing)
        .eq("is_active", true);
      if (!data) return;
      setThumbMap((prev) => {
        const next = { ...prev };
        for (const v of data as any[]) {
          const url = v.render_urls?.hero || v.render_urls?.side || v.render_urls?.roof ||
            Object.values(v.render_urls || {})[0] || v.uploaded_file_paths?.[0];
          if (url) next[v.proof_id] = url as string;
        }
        return next;
      });
    })();
  }, [rows]);

  // Bulk-load THIS user's prior proof views once we know who they are.
  // Without this, teamViews stays empty except for the proof currently
  // open, so isNewForUser() returns true for nearly every row and the
  // whole rail strobes with NEW pulses. Loading the real view history
  // means only genuinely-updated proofs flag as new.
  useEffect(() => {
    if (!team.currentUserId) return;
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("proof_team_views")
        .select("proof_id, last_viewed_at")
        .eq("user_id", team.currentUserId);
      if (cancelled || !data) return;
      const map: Record<string, string> = {};
      for (const v of data as any[]) {
        if (v.proof_id && v.last_viewed_at) map[v.proof_id] = v.last_viewed_at;
      }
      // Merge under any optimistic stamps already set this session.
      setTeamViews((prev) => ({ ...map, ...prev }));
    })();
    return () => { cancelled = true; };
  }, [team.currentUserId]);

  // Whenever the user opens a proof, stamp proof_team_views so the NEW
  // badge clears for that proof for this user. Best-effort upsert — never
  // block selection on a failure.
  useEffect(() => {
    if (!selectedId || !team.currentUserId) return;
    const nowIso = new Date().toISOString();
    setTeamViews((prev) => ({ ...prev, [selectedId]: nowIso }));
    (async () => {
      try {
        await (supabase as any)
          .from("proof_team_views")
          .upsert(
            { proof_id: selectedId, user_id: team.currentUserId, last_viewed_at: nowIso },
            { onConflict: "proof_id,user_id" },
          );
      } catch (e) {
        console.warn("[proof_team_views] upsert failed", e);
      }
    })();
  }, [selectedId, team.currentUserId]);

  // Load active version when selection changes
  useEffect(() => {
    if (!selectedId) {
      setActiveVersion(null);
      setLineItemRows([]);
      setAllVersions([]);
      setNotesDraft("");
      return;
    }
    (async () => {
      // Fetch active version
      const { data } = await supabase
        .from("proof_versions" as any)
        .select("id, version_number, created_by_role, render_urls, uploaded_file_paths, created_at")
        .eq("proof_id", selectedId)
        .eq("is_active", true)
        .maybeSingle();
      setActiveVersion(data ? (data as unknown as ActiveVersion) : null);

      // Fetch all versions for history. The browser read is RLS-gated
      // (shop_owner_versions) — WPW-shop orders can come back EMPTY even though
      // versions exist, so fall back to the service-role loader so the admin
      // workbench always shows the full history.
      const { data: versData } = await supabase
        .from("proof_versions" as any)
        .select("id, version_number, created_by_role, is_active, created_at, render_urls, uploaded_file_paths, prompt_text")
        .eq("proof_id", selectedId)
        .order("version_number", { ascending: false });
      let versList: any[] = (versData || []) as any[];
      if (!versList.length) {
        const { data: fb } = await supabase.functions.invoke("approvepro-versions", { body: { proof_id: selectedId } });
        if (Array.isArray((fb as any)?.versions)) versList = (fb as any).versions;
      }
      setAllVersions(versList as any);

      // Design Assets — clean background + transparent element PNGs for this
      // order, keyed by the generation_id the lift / 3D / Production Pack share.
      const genId = ((selected as any)?.source_visualization_id) || ((selected?.metadata as any)?.autogen_visualization_id) || null;
      if (genId) {
        const { data: dga } = await supabase
          .from("design_generation_assets" as any)
          .select("background_url, overlay_pngs")
          .eq("generation_id", genId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        setDesignAssets(dga ? { background_url: (dga as any).background_url, overlay_pngs: Array.isArray((dga as any).overlay_pngs) ? (dga as any).overlay_pngs : [] } : null);
      } else {
        setDesignAssets(null);
      }

      const { data: liData } = await supabase
        .from("proof_line_items" as any)
        .select("id, line_number, title, description, render_url, status, decline_reason, change_request")
        .eq("proof_id", selectedId)
        .order("line_number", { ascending: true });
      setLineItemRows((liData || []) as unknown as ProofLineItemRow[]);
    })();

    // Load message thread + email log (sent / resent / shop_reply /
    // revision_requested / signed / declined / send_failed). Drives both
    // the customer message thread AND the "Emails sent" panel.
    (async () => {
      const { data: events } = await supabase
        .from("proof_events" as any)
        .select("event_type, actor_role, payload, created_at")
        .eq("proof_id", selectedId)
        .in("event_type", ["instructions_requested", "customer_reply", "customer_comment", "version_saved", "shop_reply", "revision_requested", "line_item_decision", "sent", "resent", "signed", "declined", "send_failed", "email_sent"])
        .order("created_at", { ascending: true });
      setReplyEvents((events || []) as any);
    })();

    const row = rows?.find((r) => r.id === selectedId);
    setNotesDraft(row?.internal_notes || "");
    setMessageDraft(row?.message_to_customer || "");
    setShowReply(false);
    setReplyMessage("");
    // Only mutate the URL if the value would actually change.
    // Calling setSearchParams on every effect fire produced the same
    // render-loop pattern that crashed /creatormarket with React #300
    // (see PR #1703) — the same shape can present as React #310 here
    // when the loop interacts with the conditional child trees.
    const currentUrlId = new URLSearchParams(window.location.search).get("id");
    if (currentUrlId !== selectedId) {
      setSearchParams(selectedId ? { id: selectedId } : {}, { replace: true });
    }
    // Deps: only selectedId. `rows` is intentionally NOT a dependency —
    // including it made this effect re-fire every time the list refreshed
    // (loadList, the optimistic prepend in onProofLinked, or any save),
    // which re-ran 4 fetches + reset 4 state values on the detail pane,
    // causing the workbench to "blink uncontrollably" on each click. The
    // effect only needs to react to the user opening a new proof; the
    // notes/message snapshot from `rows` here is a seed, not live data
    // (save handlers already write the row + state directly).
    // setSearchParams is intentionally NOT a dependency — React Router
    // recreates it on every render and including it caused the original
    // loop that flashed the detail pane.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Auto-select first item on load if nothing selected
  useEffect(() => {
    if (!selectedId && rows && rows.length > 0) {
      setSelectedId(rows[0].id);
    }
  }, [rows, selectedId]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const f = FILTERS.find((x) => x.key === filter);
    let r = rows;
    const searching = search.trim().length > 0;
    const browsingMonth = monthFilter !== "all";
    // Searching OR browsing a month spans the WHOLE queue — ignore the status
    // tab AND the assignee chip. Otherwise "April" while on the "Active" tab
    // hides every completed April job (the #1 "month shows nothing" bug).
    // An analytics drill-down also spans the whole queue.
    const spanAll = searching || browsingMonth || !!analyticsDrill;
    if (!spanAll && f?.statuses) r = r.filter((row) => f.statuses!.includes(row.status));

    // Designers only ever see their own queue — hard scope, regardless of
    // the chip state (chips are hidden for them anyway).
    if (designerScoped) {
      r = r.filter((row) => row.assigned_to === team.currentUserId);
    } else if (!spanAll && assigneeFilter === "mine" && team.currentUserId) {
      r = r.filter((row) => row.assigned_to === team.currentUserId);
    } else if (!spanAll && assigneeFilter === "unassigned") {
      r = r.filter((row) => row.assigned_to == null);
    } else if (!spanAll && assigneeFilter !== "all") {
      r = r.filter((row) => row.assigned_to === assigneeFilter);
    }

    // Month browse — filter to the chosen month (spans all statuses above).
    if (browsingMonth) {
      r = r.filter((row) => monthKey(rowOrderDate(row)) === monthFilter);
    }

    // ENFORCED: ApprovePro only ever shows real WPW design orders. This is
    // not an optional toggle — RestylePro internal proofs and pure print
    // orders must never appear in the design queue.
    r = r.filter((row) => isDesignOrder(row));

    // CHWD lane — narrow to Custom Vehicle Wrap Design orders only. Spans all
    // statuses/months (it's an order-TYPE filter, not a status lane).
    if (chwdOnly) {
      r = r.filter((row) => lineItemsAreCustomWrapDesign(row.metadata?.line_items));
    }

    // Analytics drill-down — narrow to the clicked card's matching orders.
    if (analyticsDrill) {
      const preds: Record<string, (row: any) => boolean> = {
        ace_sent: (row) => row.metadata?.autogen_status === "done" && !!row.sent_at,
        revisions: (row) => Number(row.ai_revisions_used || 0) > 0,
        approved: (row) => row.status === "approved",
        approved_ready: (row) => row.status === "approved" && row.metadata?.order_intent === "ready",
        approved_later: (row) => row.status === "approved" && row.metadata?.order_intent !== "ready",
        // Missing info: draft orders with no relevant brief — need the invite.
        missing_info: (row) => row.status === "draft" && !classifyIntake(row.metadata).hasBrief,
      };
      const p = preds[analyticsDrill.key];
      if (p) r = r.filter(p);
    }

    if (searching) {
      const q = search.trim().toLowerCase();
      r = r.filter((row) => {
        const m = row.metadata || {};
        const lineItemNames = Array.isArray(m.line_items)
          ? m.line_items.map((li: any) => li?.name)
          : [];
        return [
          row.customer_name, row.customer_email, row.design_name,
          row.vehicle_year, row.vehicle_make, row.vehicle_model,
          m.wpw_order_number, m.wpw_woo_order_id, m.woo_order_number, m.woo_order_id,
          // Also match the customer's note (so "trailer" finds it) and the
          // ordered product names (so "custom vehicle wrap design" finds it).
          m.order_customer_note, m.customer_note, m.line_item_brief,
          ...lineItemNames,
        ].filter((v) => v != null).some((v) => String(v).toLowerCase().includes(q));
      });
    }
    // Stable, deterministic order: newest order date first, tie-broken by id.
    // Ordering by a value that never changes (the order date) means a
    // background refetch / window-focus re-render can't reshuffle the list or
    // bounce the user's scroll position.
    r = [...r].sort((a, b) => {
      const da = new Date(rowOrderDate(a) || 0).getTime();
      const db = new Date(rowOrderDate(b) || 0).getTime();
      if (db !== da) return db - da;
      return String(a.id).localeCompare(String(b.id));
    });
    return r;
  }, [rows, filter, search, assigneeFilter, team.currentUserId, designerScoped, monthFilter, analyticsDrill, chwdOnly]);

  // Distinct months present in the queue (newest first) for the browse dropdown.
  const availableMonths = useMemo(() => {
    const keys = new Set<string>();
    for (const row of rows || []) {
      const k = monthKey(rowOrderDate(row));
      if (k) keys.add(k);
    }
    return Array.from(keys).sort().reverse();
  }, [rows]);

  // Helper: is this proof "new" for the current user (updated since they
  // last opened it)? Used for the NEW pulse on list rows.
  const isNewForUser = (proofId: string, updatedAt: string): boolean => {
    const lastView = teamViews[proofId];
    if (!lastView) return true; // never opened
    return new Date(updatedAt).getTime() > new Date(lastView).getTime();
  };

  // Base set the badges + tab counts are computed over. ApprovePro is design-
  // orders-only by enforcement, so the counts mirror the same filter the list
  // uses — Mine / Unassigned / All only ever count real WPW design orders.
  const countBase = useMemo(
    () => (rows || []).filter((r) => isDesignOrder(r)),
    [rows],
  );

  // CHWD lane count — Custom Vehicle Wrap Design orders in the design queue.
  const chwdCount = useMemo(
    () => countBase.filter((r) => lineItemsAreCustomWrapDesign(r.metadata?.line_items)).length,
    [countBase],
  );

  // Count of proofs needing attention from the current user, displayed as
  // a small "Mine" badge so a designer can see at a glance how much is on
  // their plate vs the whole team's queue.
  const mineCount = useMemo(() => {
    if (!team.currentUserId) return 0;
    return countBase.filter((r) => r.assigned_to === team.currentUserId && r.status !== "approved" && r.status !== "declined" && r.status !== "revoked" && r.status !== "expired").length;
  }, [countBase, team.currentUserId]);

  const unassignedActiveCount = useMemo(() => {
    return countBase.filter((r) => r.assigned_to == null && (r.status === "draft" || r.status === "sent" || r.status === "viewed" || r.status === "revising")).length;
  }, [countBase]);

  const counts = useMemo(() => {
    const r = countBase;
    const c: Record<FilterKey, number> = {
      all: r.length, needs_you: 0, awaiting: 0, done: 0,
    };
    for (const row of r) {
      for (const f of FILTERS) {
        if (f.statuses && f.statuses.includes(row.status)) c[f.key]++;
      }
    }
    return c;
  }, [countBase]);

  const selected = rows?.find((r) => r.id === selectedId) || null;

  // Seed the "Give A.C.E context" box from whatever brief the order already
  // has, each time the selected order changes.
  useEffect(() => {
    const md = (selected?.metadata || {}) as any;
    setAceBrief(
      (typeof md.line_item_brief === "string" && md.line_item_brief) ||
      (typeof md.customer_note === "string" && md.customer_note) || "",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Full linked WooCommerce order for WPW-linked proofs. Drives the "Paid"
  // figure + Print Work Order button in the header AND the Work Order sheet
  // rendered in the Order tab (addresses, SKUs, per-item totals, etc.).
  const linkedWooId = selected?.metadata?.wpw_woo_order_id
    ? Number(selected.metadata.wpw_woo_order_id)
    : null;

  // Detail-pane tabs: "order" keeps the work-order info (brief, products,
  // files, customer) on its own tab so it doesn't scroll away while the
  // designer uploads + sends correspondence on the "send" tab. Reset to
  // the order tab whenever a different proof is opened.
  useEffect(() => {
    setDetailTab("workorder");
  }, [selectedId]);

  // Real design-order revenue from wpw_orders (the proof rows carry no totals)
  // for the analytics Paid/Converted card + its rolling-window tags.
  const [revenue, setRevenue] = useState<{ total: number; windows: { d: number; sum: number; orders: number }[] } | null>(null);
  // Per-order design fee (order_number → paid total) so each job card can show
  // its $ under the thumbnail.
  const [orderTotals, setOrderTotals] = useState<Record<string, number>>({});
  // DESIGN jobs only — revenue is the value of the design orders in this queue,
  // never any non-design WPW order.
  const orderNums = useMemo(() => Array.from(new Set((rows || [])
    .filter((r) => isDesignOrder(r))
    .map((r) => r.metadata?.wpw_order_number || r.metadata?.wpw_woo_order_id)
    .filter(Boolean).map(String))), [rows]);
  useEffect(() => {
    if (!orderNums.length) { setRevenue(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("wpw_orders" as any)
        .select("order_number,total,date_created")
        .in("order_number", orderNums.slice(0, 1000));
      if (cancelled) return;
      const now = Date.now();
      const windows = [1, 7, 30, 60, 90].map((d) => {
        const cutoff = now - d * 86_400_000;
        let sum = 0, orders = 0;
        for (const o of (data || []) as any[]) {
          const t = o.date_created ? new Date(o.date_created).getTime() : 0;
          if (t >= cutoff) { sum += Number(o.total) || 0; orders++; }
        }
        return { d, sum, orders };
      });
      const total = ((data || []) as any[]).reduce((s, o) => s + (Number(o.total) || 0), 0);
      const totalsMap: Record<string, number> = {};
      for (const o of (data || []) as any[]) {
        if (o.order_number != null) totalsMap[String(o.order_number)] = Number(o.total) || 0;
      }
      setOrderTotals(totalsMap);
      setRevenue({ total, windows });
    })();
    return () => { cancelled = true; };
  }, [orderNums]);
  const { data: linkedOrder } = useWpwOrder(linkedWooId);

  const formatCurrency = (amount: number | null | undefined, code?: string | null) => {
    if (amount == null) return null;
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: code || "USD" }).format(amount);
    } catch {
      return `$${amount.toFixed(2)}`;
    }
  };

  // Print the Work Order. WPW-linked proofs print the real mirror order.
  // Everything else (Design Setup, Hourly Design, manually-created proofs)
  // had NO print path at all — so we build a printable order straight from
  // the proof: customer, the design-request MESSAGE, and reference uploads
  // / documents. Reuses the existing /wpw-orders/:id/print page so the
  // layout is identical, by stashing a synthetic WpwOrder for it to read.
  // Send this order to print production — creates a print_production_request
  // that lands in the admin Print Production Queue (same record the customer's
  // "Request Print-Ready Files" button creates). Lets the shop order the
  // $299 production pack on the customer's behalf.
  const [sendingToProduction, setSendingToProduction] = useState(false);
  const handleSendToProduction = async () => {
    if (!selected) return;
    setSendingToProduction(true);
    try {
      const md = (selected.metadata || {}) as Record<string, any>;
      const { error } = await supabase.from("print_production_requests" as any).insert({
        design_id: selected.id,
        order_number: md.wpw_order_number ? String(md.wpw_order_number) : `PROOF-${selected.id.slice(0, 8)}`,
        customer_name: selected.customer_name || null,
        vehicle_year: selected.vehicle_year || null,
        vehicle_make: selected.vehicle_make || null,
        vehicle_model: selected.vehicle_model || null,
        approved_proof_url: productionProofUrl(activeVersion) || null,
        requested_output_type: "full_wrap_panels",
        payment_status: "paid",
        amount_cents: 29900,
        production_status: "paid_submitted",
      });
      if (error) throw error;

      // SANCTIONED PRODUCTION HANDOFF (Trish 2026-07-24): build the per-side
      // entice panels through THE single producer — enticePanelsFromProof (the
      // same chain DesignPro generation and RevisionStudio revisions fire), so
      // ApprovePro panels land in production_flow_assets and flow to the
      // RevisionStudio Production Layers, the PanelPro Studio Board, the Railway
      // hi-res build, the QC checklist/stamp, and WrapBox. Replaces the legacy
      // production-flow-engine mode:"separate" per-side layer split (its
      // generative branding pass invented designs and its output landed in a
      // store the sanctioned chain filters out). Fire-and-forget: wrapped +
      // non-blocking so it can never break the queue handoff above.
      // WPW/autogen jobs store their design under metadata.autogen_visualization_id
      // (source_visualization_id is only set for RestylePro-native designs).
      const genId = ((selected as any).source_visualization_id || (selected.metadata as any)?.autogen_visualization_id) as string | undefined;
      if (genId) {
        (async () => {
          try {
            const { data: dga } = await supabase
              .from("design_generation_assets" as any)
              .select("background_url, view_urls")
              .eq("generation_id", genId)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            const views = (dga as any)?.view_urls && typeof (dga as any).view_urls === "object"
              ? (dga as any).view_urls as Record<string, string>
              : {};
            const proofUrl = productionProofUrl(activeVersion) || "";
            if (!proofUrl && !Object.keys(views).length) return; // nothing to extract from
            const r = await enticePanelsFromProof({
              gid: genId,
              proofUrl,
              make: selected.vehicle_make || "",
              model: selected.vehicle_model || "",
              year: String(selected.vehicle_year || ""),
              allViewUrls: views,
              artboardCleanUrl: (dga as any)?.background_url || null,
              // The Railway hi-res build fires on Order Production Pack (the
              // paid path) — this handoff only builds the entice panels.
              triggerWorker: false,
            });
            if (r.built === 0) console.warn("[ApprovePro] entice build produced no panels:", r.reason);
          } catch (pfErr) {
            console.warn("[ApprovePro] production handoff (non-blocking) failed:", pfErr);
          }
        })();
      }

      toast.success("Sent to Print Production — building print files & queued for the design team.");
    } catch (e: any) {
      toast.error(e.message || "Could not send to production");
    } finally {
      setSendingToProduction(false);
    }
  };

  const handlePrintWorkOrder = () => {
    if (!selected) return;

    const md = (selected.metadata || {}) as Record<string, any>;

    // Assemble EVERY customer note + instruction so the work order always
    // carries them: the checkout note, the "please describe" design brief,
    // and any per-line-item instructions / active revision requests.
    const orderNote: string | undefined = md.order_customer_note;
    const rawBrief: string | null =
      (typeof md.line_item_brief === "string" && md.line_item_brief) ||
      (typeof md.customer_note === "string" && md.customer_note && md.customer_note !== orderNote
        ? md.customer_note
        : null);
    let brief = rawBrief;
    if (orderNote && rawBrief && rawBrief.startsWith(orderNote)) {
      brief = rawBrief.slice(orderNote.length).replace(/^\s*\n+/, "").trim();
    }
    const itemInstructions = (lineItemRows || [])
      .map((li) => {
        const parts = [
          li.description?.trim(),
          li.status === "revising" && li.change_request ? `Revise: ${li.change_request.trim()}` : null,
        ].filter(Boolean);
        if (parts.length === 0) return null;
        const label = (li.title?.trim() || `Item ${li.line_number ?? ""}`).trim();
        return `${label}: ${parts.join(" — ")}`;
      })
      .filter(Boolean) as string[];
    const customerMessage =
      [orderNote, brief, ...itemInstructions].filter(Boolean).join("\n\n").trim() || null;

    // Linked WPW order: print the real mirror order, but merge in any proof
    // notes/instructions the Woo note doesn't already contain so nothing the
    // customer wrote is missing from the printed sheet.
    if (linkedOrder) {
      const existing = (linkedOrder.customer_note || "").trim();
      const additions = [brief, ...itemInstructions]
        .filter((s) => s && !existing.includes(s))
        .join("\n\n")
        .trim();
      const mergedNote = [existing, additions].filter(Boolean).join("\n\n").trim() || null;
      stashOrderForPrint({ ...linkedOrder, customer_note: mergedNote });
      window.open(`/wpw-orders/${linkedOrder.id}/print`, "_blank", "noopener");
      return;
    }

    // Carry reference uploads + documents through to the sheet by stuffing
    // their URLs into a synthetic line-item meta blob — extractBriefAndUploads
    // (used by WorkOrderSheet) classifies each URL into artwork vs files.
    const uploadUrls: string[] = Array.isArray(md.customer_uploads) ? md.customer_uploads : [];
    const documentUrls: string[] = Array.isArray(md.customer_documents) ? md.customer_documents : [];
    const refMeta = [...uploadUrls, ...documentUrls].map((url, i) => ({ key: `ref_${i}`, value: url }));

    const printId = Number(md.wpw_order_number) || Number(md.wpw_woo_order_id) || Math.floor(Math.random() * 1e9) + 1e9;

    const synthetic: WpwOrder = {
      id: printId,
      woo_customer_id: 0,
      user_id: null,
      order_number: md.wpw_order_number ? String(md.wpw_order_number) : `PROOF-${selected.id.slice(0, 8)}`,
      status: selected.status || "draft",
      currency: "USD",
      total: 0,
      subtotal: null,
      shipping_total: null,
      tax_total: null,
      payment_method: null,
      date_created: selected.created_at || null,
      date_modified: null,
      date_completed: null,
      customer_email: selected.customer_email || null,
      customer_name: selected.customer_name || null,
      tracking_number: null,
      tracking_carrier: null,
      tracking_url: null,
      order_key: null,
      pay_url: null,
      customer_note: customerMessage,
      billing: selected.customer_phone ? { phone: selected.customer_phone } : null,
      shipping: null,
      wpw_order_items: refMeta.length > 0
        ? [{
            // Carrier row holding the reference URLs — WorkOrderSheet pulls
            // artwork/files out of meta. It has no name/price so the items
            // table (which skips nameless, zero-priced rows) won't show it.
            id: 9999,
            order_id: printId,
            product_id: null,
            variation_id: null,
            name: null,
            sku: null,
            quantity: 1,
            subtotal: 0,
            total: 0,
            image_url: null,
            meta: refMeta,
          }]
        : [],
    };

    stashOrderForPrint(synthetic);
    window.open(`/wpw-orders/${printId}/print`, "_blank", "noopener");
  };

  const refreshSelected = async () => {
    if (!selectedId) return;
    const { data: row } = await supabase
      .from("proof_approvals" as any)
      .select("*")
      .eq("id", selectedId)
      .maybeSingle();
    if (!row) return;
    setRows((prev) => (prev || []).map((p) => (p.id === selectedId ? (row as unknown as ProofRow) : p)));
    const { data: ver } = await supabase
      .from("proof_versions" as any)
      .select("id, version_number, created_by_role, render_urls, uploaded_file_paths, created_at")
      .eq("proof_id", selectedId)
      .eq("is_active", true)
      .maybeSingle();
    setActiveVersion(ver ? (ver as unknown as ActiveVersion) : null);

    // Refresh the version history so a freshly uploaded/revised version
    // shows up (with its thumbnail) without a full reload.
    const { data: versData } = await supabase
      .from("proof_versions" as any)
      .select("id, version_number, created_by_role, is_active, created_at, render_urls, uploaded_file_paths, prompt_text")
      .eq("proof_id", selectedId)
      .order("version_number", { ascending: false });
    let versList2: any[] = (versData || []) as any[];
    if (!versList2.length) {
      const { data: fb } = await supabase.functions.invoke("approvepro-versions", { body: { proof_id: selectedId } });
      if (Array.isArray((fb as any)?.versions)) versList2 = (fb as any).versions;
    }
    setAllVersions(versList2 as any);

    const { data: liData } = await supabase
      .from("proof_line_items" as any)
      .select("id, line_number, title, description, render_url, status, decline_reason, change_request")
      .eq("proof_id", selectedId)
      .order("line_number", { ascending: true });
    setLineItemRows((liData || []) as unknown as ProofLineItemRow[]);
    setTimelineRefreshKey((k) => k + 1);
  };

  // EMBEDDED EDITOR BRIDGE — the in-place RevisionStudio iframe posts back when
  // it saves a new version (and again if the user just wants to close). We close
  // the overlay and refresh the version list so the new version appears here
  // immediately — no page bounce, no "what's the next step".
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const t = (e.data || {}).type;
      if (t === "revisionstudio:saved") {
        setEditorUrl(null);
        refreshSelected();
        loadList();
        toast({ title: "Edit saved", description: "New version added and the customer was notified." });
      } else if (t === "revisionstudio:close") {
        setEditorUrl(null);
      }
    };
    window.addEventListener("message", onMessage);
    // Sprocket (the global agent) fires this after it revises / switches / sends
    // on the open order — refresh the workbench so the new version shows here.
    const onSprocket = (e: Event) => {
      const pid = (e as CustomEvent).detail?.proofId;
      if (!pid || pid === selectedId) {
        refreshSelected();
        loadList();
        // Take the user straight to the Versions strip and flash it so they're
        // watching the right spot when the new version lands (~30–60s later).
        setTimeout(() => {
          const el = document.getElementById("approvepro-versions-strip");
          if (!el) return;
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.style.boxShadow = "0 0 0 3px rgba(59,130,246,0.6)";
          setTimeout(() => { el.style.boxShadow = ""; }, 2200);
        }, 300);
      }
    };
    window.addEventListener("sprocket:order-changed", onSprocket as EventListener);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("sprocket:order-changed", onSprocket as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Live auto-refresh — keep the OPEN order in sync with the server so a freshly
  // generated version (and ALL its angle renders) appears in the workbench
  // WITHOUT a manual reselect/reload. The ref mirrors what's on screen; the
  // poller cheaply checks the DB's active version + autogen status every 10s and
  // only triggers the heavy refresh when something actually changed — so there's
  // no re-render flicker when nothing's new.
  const shownStateRef = useRef<{ activeId: string | null; status: string | null }>({ activeId: null, status: null });
  shownStateRef.current = {
    activeId: activeVersion?.id || null,
    status: ((selected?.metadata as any)?.autogen_status ?? null),
  };
  // Tracks the active-version id at the moment a "running" generation began, so
  // we can auto-clear the progress flag the instant a NEWER version lands (the
  // surgical revision path that Sprocket triggers doesn't reset autogen_status
  // itself, so without this the workbench progress bar would stick on "running").
  const runningSinceRef = useRef<{ at: number; activeId: string | null } | null>(null);
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    const tick = async () => {
      const [{ data: ver }, { data: pa }] = await Promise.all([
        supabase.from("proof_versions" as any).select("id").eq("proof_id", selectedId).eq("is_active", true).maybeSingle(),
        supabase.from("proof_approvals" as any).select("metadata").eq("id", selectedId).maybeSingle(),
      ]);
      if (cancelled) return;
      const dbActiveId = (ver as any)?.id || null;
      const md = ((pa as any)?.metadata as any) || {};
      const dbStatus = md.autogen_status ?? null;

      // Auto-clear a stuck "running" flag: remember when it started; once a
      // different active version appears (the revision finished) or ~3 min pass,
      // wipe autogen_status so the progress bar resolves.
      if (dbStatus === "running") {
        if (!runningSinceRef.current) runningSinceRef.current = { at: Date.now(), activeId: dbActiveId };
        const since = runningSinceRef.current;
        const newVersionLanded = since.activeId && dbActiveId && dbActiveId !== since.activeId;
        const tooOld = Date.now() - since.at > 180000;
        if (newVersionLanded || tooOld) {
          const cleared = { ...md }; delete cleared.autogen_status; delete cleared.autogen_started_at;
          await supabase.from("proof_approvals" as any).update({ metadata: cleared }).eq("id", selectedId);
          runningSinceRef.current = null;
          refreshSelected();
          return;
        }
      } else {
        runningSinceRef.current = null;
      }

      const shown = shownStateRef.current;
      if (dbActiveId !== shown.activeId || dbStatus !== shown.status) refreshSelected();
    };
    // Poll a bit faster (5s) so the bar appears/clears promptly during a revise.
    const t = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Step 2 — every NEW version regenerates its 2D production proof (the
  // dimensioned print-file source) so the version history always carries a
  // current proof. A.C.E already does this on generate; the manual paths
  // (upload fresh files / attach a design / pull from QC) did not, so fire it
  // after those create a version. Non-blocking on failure; refreshes when done.
  const regenVersionProof = async () => {
    if (!selectedId) return;
    try {
      toast({ title: "Building 2D production proof…", description: "Generating the print-file source for this version." });
      const { data, error } = await supabase.functions.invoke("approvepro-version-proof", {
        body: { proof_id: selectedId },
      });
      if (error || !(data as any)?.success) {
        toast({ title: "2D proof not generated", description: (data as any)?.error || error?.message || "Failed", variant: "destructive" });
      } else {
        toast({ title: "2D production proof ready" });
      }
    } catch (e: any) {
      toast({ title: "2D proof error", description: e?.message || "Failed", variant: "destructive" });
    } finally {
      refreshSelected();
    }
  };

  const isTerminal = (s: ProofStatus) => ["approved", "declined", "revoked", "expired"].includes(s);

  const handleResend = async () => {
    if (!selected) return;
    // Guard: never email the customer a proof that has no real design — i.e.
    // the only image is the auto-synced WePrintWraps product stock photo and
    // nothing was uploaded/attached. This is exactly how a customer ended up
    // getting a placeholder instead of the artwork.
    const noRealDesign =
      !activeVersion ||
      (((activeVersion.uploaded_file_paths?.length ?? 0) === 0) &&
        activeVersion.created_by_role === "system_upload" &&
        !(Array.isArray(selected?.metadata?.customer_uploads) && selected.metadata.customer_uploads.length > 0));
    if (noRealDesign) {
      const ok = window.confirm(
        "This proof has NO design attached — only the WePrintWraps product placeholder image.\n\nThe customer would receive a stock photo, not your design. Attach a design (the 'Attach a design you made' button below) or upload one first.\n\nSend the placeholder anyway?",
      );
      if (!ok) return;
    }
    setBusyAction("resend");
    try {
      const { data, error } = await supabase.functions.invoke("proof-send", {
        body: { proof_id: selected.id, force: true },
      });
      if (error || !data?.success) {
        toast({
          title: "Resend failed",
          description: (data as any)?.error || error?.message || "Failed",
          variant: "destructive",
        });
      } else {
        toast({
          title: data.already_sent ? "Already sent" : "Resent",
          description: `Email on its way to ${selected.customer_email}`,
        });
        await refreshSelected();
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleTextProof = async () => {
    if (!selected) return;
    const phone =
      (selected as any).customer_phone ||
      (linkedOrder as any)?.billing?.phone ||
      (linkedOrder as any)?.phone ||
      null;
    setBusyAction("text");
    try {
      const { data, error } = await supabase.functions.invoke("proof-send-sms", {
        body: { proof_id: selected.id, phone },
      });
      if (error || !data?.success) {
        toast({
          title: "Couldn't text the proof",
          description: (data as any)?.error || error?.message || "Failed",
          variant: "destructive",
        });
      } else {
        toast({ title: "Proof texted", description: `Sent to ${data.to} — they can approve/revise from their phone.` });
        await refreshSelected();
      }
    } finally {
      setBusyAction(null);
    }
  };

  // CHECK THE DESIGN EMAIL — run the design-mailbox API (Outlook via the Azure
  // Graph app) for THIS order on demand. Customers order first and email the
  // real material second ("I'll send a follow up email with the mockups and our
  // logo"); this pulls that email's body + attachments onto the order so A.C.E.
  // designs from what they actually sent instead of inventing a wrap.
  //
  // A.C.E. runs the same pull automatically before every generation — this
  // button is for the designer who wants to look NOW, or who just told the
  // customer to send the files and wants them on the order before hitting GO.
  const handleCheckDesignInbox = async () => {
    if (!selected) return;
    setBusyAction("inbox");
    try {
      const before = (((selected.metadata as any)?.customer_uploads) || []).length;
      const { data, error } = await supabase.functions.invoke("intake-graph-poll", {
        body: { mode: "search", proof_id: selected.id },
      });
      if (error) {
        toast({ title: "Couldn't reach the design inbox", description: error.message || "Try again", variant: "destructive" });
        return;
      }
      if ((data as any)?.configured === false) {
        toast({
          title: "Design inbox not connected",
          description: "The Microsoft Graph secrets (MS_GRAPH_*) aren't set for design@weprintwraps.com yet.",
          variant: "destructive",
        });
        return;
      }
      await refreshSelected();
      const { data: fresh } = await supabase
        .from("proof_approvals" as any)
        .select("metadata")
        .eq("id", selected.id)
        .maybeSingle();
      const after = ((((fresh as any)?.metadata as any)?.customer_uploads) || []).length;
      const gained = Math.max(0, after - before);
      const found = Number((data as any)?.found) || 0;
      toast({
        title: found > 0 ? `Pulled ${found} email${found === 1 ? "" : "s"} from the design inbox` : "No new email found",
        description: gained > 0
          ? `${gained} new file${gained === 1 ? "" : "s"} added to Customer Provided Assets — GO will now design from them.`
          : found > 0
            ? "Their message was folded into the brief. No new attachments."
            : `Nothing from ${selected.customer_email || "this customer"} in design@weprintwraps.com yet.`,
      });
    } finally {
      setBusyAction(null);
    }
  };

  // AI-first: let the designer tell Ace to generate the first design for an
  // order that has no design yet (same pipeline as the auto-trigger, but on
  // demand from the AI Action Bar).
  const handleGenerateDesign = async () => {
    if (!selected) return;
    setBusyAction("autogen");
    try {
      const { data, error } = await supabase.functions.invoke("approvepro-autogen-design", {
        body: { proof_id: selected.id },
      });
      if (error || (data && (data as any).error)) {
        toast({ title: "Couldn't start AI design", description: (data as any)?.error || error?.message || "Failed", variant: "destructive" });
      } else {
        toast({ title: "Ace is designing…", description: "Generating the first concept — this refreshes when it's ready." });
        await refreshSelected();
      }
    } finally {
      setBusyAction(null);
    }
  };

  // START OVER — the ONLY way to throw away the current design and rebuild a
  // brand-new one from the brief (DesignPro from scratch). Deliberate + confirmed
  // because it's destructive: the autogen guard refuses to clobber an existing
  // design unless force:true, so this is the single explicit escape hatch. Use
  // "Edit this design" for changes that should KEEP the wrap.
  const handleStartOver = async () => {
    if (!selected) return;
    const ok = window.confirm(
      "Start over from the brief?\n\nThis builds a BRAND-NEW design from scratch (DesignPro) and replaces the current one as a new version. The old version stays in history, but the new design will look different.\n\nFor a small change that keeps the current wrap, use \"Edit this design\" instead.",
    );
    if (!ok) return;
    setBusyAction("autogen");
    try {
      const { data, error } = await supabase.functions.invoke("approvepro-autogen-design", {
        body: { proof_id: selected.id, force: true },
      });
      if (error || (data && (data as any).error)) {
        toast({ title: "Couldn't start over", description: (data as any)?.error || error?.message || "Failed", variant: "destructive" });
      } else {
        toast({ title: "Building a new design…", description: "DesignPro is rebuilding from the brief — this refreshes when it's ready." });
        await refreshSelected();
      }
    } finally {
      setBusyAction(null);
    }
  };

  // Generate / regenerate the 3D PROOF (the multi-angle photoreal set) on demand
  // from the admin — same pipeline as GO. It FIRST clears the stuck autogen_status
  // so a finished order doesn't silently no-op (the "GO did nothing" bug: autogen
  // short-circuits when status is done/running). Runs the shared DesignPro /
  // RecreatePro OS: design mailbox → hero → cloned views → 2D proof (which emits
  // the artboards). Mirrors RevisionStudio's generate action, admin-side.
  const handleGenerate3DProof = async () => {
    if (!selected) return;
    setBusyAction("autogen");
    try {
      // Re-fetch fresh metadata so we never clobber a just-saved edit instruction
      // (manual_prompt) with stale React state — that instruction is what the
      // surgical revision path consumes.
      const { data: fresh } = await supabase.from("proof_approvals" as any).select("metadata").eq("id", selected.id).maybeSingle();
      const md: any = { ...(((fresh as any)?.metadata as any) || (selected.metadata as any) || {}) };
      delete md.autogen_status;
      await supabase.from("proof_approvals" as any).update({ metadata: md }).eq("id", selected.id);
      const { data, error } = await supabase.functions.invoke("approvepro-autogen-design", {
        body: { proof_id: selected.id },
      });
      if (error || (data && (data as any).error)) {
        toast({ title: "Couldn't start 3D proof", description: (data as any)?.error || error?.message || "Failed", variant: "destructive" });
      } else {
        toast({ title: "A.C.E is generating the 3D proof…", description: "Checks the design inbox → designs → 3D angles → 2D proof. Refreshes when ready." });
        await refreshSelected();
      }
    } finally {
      setBusyAction(null);
    }
  };

  const scrollToRevise = () => {
    document.getElementById("revise-zone")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // Manually fire a customer email via the AP Task Manager (force = ignore
  // cadence). kind: undefined = auto-pick; or a specific nudge / the 3D upsell.
  const handleManualFollowup = async (kind?: string, label?: string) => {
    if (!selected) return;
    setBusyAction("followup");
    try {
      const { data, error } = await supabase.functions.invoke("approvepro-followup-sweep", {
        body: { proof_id: selected.id, kind, force: true },
      });
      if (error || !(data as any)?.ok) {
        toast({ title: "Couldn't send", description: (data as any)?.error || error?.message || "Try again", variant: "destructive" });
      } else if (!(data as any).sent) {
        toast({ title: "Nothing to send", description: "No applicable nudge for this order right now." });
      } else {
        toast({ title: `Sent: ${label || (data as any).sent}`, description: `Emailed ${selected.customer_email}.` });
        await refreshSelected();
      }
    } finally {
      setBusyAction(null);
    }
  };

  // Delete a single proof view (admin) — e.g. KD's trailer "Front" that's
  // actually a side angle. Removes the key from the active version's render_urls
  // and persists. The design + other views are untouched.
  const handleDeleteView = async (key: string) => {
    if (!selected || !activeVersion?.id) return;
    if (!window.confirm(`Delete the "${key}" view from this proof? You can regenerate it after.`)) return;
    setViewBusyKey(key);
    try {
      const ru: Record<string, string> = { ...(activeVersion.render_urls || {}) };
      delete ru[key];
      const { error } = await supabase
        .from("proof_versions" as any)
        .update({ render_urls: ru })
        .eq("id", activeVersion.id);
      if (error) {
        toast({ title: "Couldn't delete view", description: error.message, variant: "destructive" });
        return;
      }
      setActiveVersion({ ...activeVersion, render_urls: ru } as ActiveVersion);
      setAllVersions((vs) => vs.map((v) => (v.id === activeVersion.id ? { ...v, render_urls: ru } : v)));
      toast({ title: "View deleted", description: `Removed "${key}". Regenerate it from GO when ready.` });
    } finally {
      setViewBusyKey(null);
    }
  };

  // Wipe EVERY view + the 2D proof off the active version in one shot — the
  // "clear the slop" button for when a whole design is wrong and you want to
  // re-import or regenerate from a clean slate. Same proof_versions update as
  // handleDeleteView, just emptying render_urls entirely.
  const handleDeleteAllViews = async () => {
    if (!selected || !activeVersion?.id) return;
    if (!window.confirm("Delete ALL angles AND the 2D proof from this proof's current version? You can re-import or regenerate after.")) return;
    setViewBusyKey("__all__");
    try {
      const { error } = await supabase
        .from("proof_versions" as any)
        .update({ render_urls: {} })
        .eq("id", activeVersion.id);
      if (error) {
        toast({ title: "Couldn't clear the design", description: `${error.message} (admin permission may be required)`, variant: "destructive" });
        return;
      }
      setActiveVersion({ ...activeVersion, render_urls: {} } as ActiveVersion);
      setAllVersions((vs) => vs.map((v) => (v.id === activeVersion.id ? { ...v, render_urls: {} } : v)));
      toast({ title: "Design cleared", description: "Every angle and the 2D proof were removed. Re-import or regenerate when ready." });
    } finally {
      setViewBusyKey(null);
    }
  };

  // DELETE A WHOLE PROOF — drop a bad/duplicate draft order out of ApprovePro
  // entirely (shop-scoped, server-side via the proof-delete edge function). On
  // success we pull it from the in-memory list, advance the selection if it was
  // the open order, and refresh the queue.
  const handleDeleteProof = async (proofId: string) => {
    if (!proofId) return;
    if (!window.confirm("Delete this entire proof/order from ApprovePro? This cannot be undone.")) return;
    setDeletingProofs(true);
    try {
      const { error } = await supabase.functions.invoke("proof-delete", { body: { proof_id: proofId } });
      if (error) {
        let msg = error.message || "Delete failed";
        const ctx = (error as any)?.context;
        if (ctx && typeof ctx.json === "function") {
          try { const b = await ctx.json(); if (b?.error) msg = b.error; } catch { /* keep generic */ }
        }
        toast({ title: "Couldn't delete proof", description: msg, variant: "destructive" });
        return;
      }
      // Drop from the in-memory list and advance selection if it was open.
      setRows((prev) => {
        const next = (prev || []).filter((p) => p.id !== proofId);
        if (selectedId === proofId) setSelectedId(next[0]?.id || null);
        return next;
      });
      toast({ title: "Proof deleted", description: "The order was removed from ApprovePro." });
      loadList();
    } finally {
      setDeletingProofs(false);
    }
  };

  // DELETE ALL SHOWN — nuke every proof currently visible in the queue (the
  // filtered set). Batched through proof-delete with proof_ids[]. Guarded by an
  // explicit count confirm so it can't fire by accident.
  const handleDeleteAllShown = async () => {
    const ids = filtered.map((r) => r.id);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete all ${ids.length} shown proof${ids.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
    setDeletingProofs(true);
    try {
      const { error } = await supabase.functions.invoke("proof-delete", { body: { proof_ids: ids } });
      if (error) {
        let msg = error.message || "Delete failed";
        const ctx = (error as any)?.context;
        if (ctx && typeof ctx.json === "function") {
          try { const b = await ctx.json(); if (b?.error) msg = b.error; } catch { /* keep generic */ }
        }
        toast({ title: "Couldn't delete proofs", description: msg, variant: "destructive" });
        return;
      }
      const idSet = new Set(ids);
      setRows((prev) => (prev || []).filter((p) => !idSet.has(p.id)));
      setSelectedId(null);
      toast({ title: `Deleted ${ids.length} proof${ids.length === 1 ? "" : "s"}`, description: "The shown orders were removed from ApprovePro." });
      loadList();
    } finally {
      setDeletingProofs(false);
    }
  };

  // MANUAL UPLOAD onto a view — operator drops a corrected image for a specific
  // angle (driver/passenger/front/rear/roof/hood/hero) OR the 2D proof
  // (viewKey === "production_proof"), writing it onto the active version's
  // render_urls under that key. Same storage pattern as handleAceUpload and the
  // same proof_versions persistence as handleDeleteView.
  const uploadViewImage = async (viewKey: string, file: File) => {
    if (!selected || !activeVersion?.id || !file) return;
    setUploadViewKey(viewKey);
    try {
      const ext = (file.name.split(".").pop() || "png").replace(/[^a-zA-Z0-9]/g, "") || "png";
      const path = `approvepro-uploads/${selected.id}/${viewKey}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("wrap-files").upload(path, file, { contentType: file.type, upsert: true });
      if (upErr) { toast({ title: "Upload failed", description: upErr.message, variant: "destructive" }); return; }
      const { data: pub } = supabase.storage.from("wrap-files").getPublicUrl(path);
      const url = pub?.publicUrl;
      if (!url) { toast({ title: "Upload failed", description: "Couldn't resolve the uploaded image URL.", variant: "destructive" }); return; }
      const ru: Record<string, string> = { ...(activeVersion.render_urls || {}), [viewKey]: url };
      const { error } = await supabase.from("proof_versions" as any).update({ render_urls: ru }).eq("id", activeVersion.id);
      if (error) {
        toast({ title: "Couldn't save image", description: `${error.message} (admin permission may be required)`, variant: "destructive" });
        return;
      }
      setActiveVersion({ ...activeVersion, render_urls: ru } as ActiveVersion);
      setAllVersions((vs) => vs.map((v) => (v.id === activeVersion.id ? { ...v, render_urls: ru } : v)));
      toast({ title: "Image uploaded", description: viewKey === "production_proof" ? "Replaced the 2D proof on this version." : `Set the "${viewKey}" view on this version.` });
    } finally {
      setUploadViewKey(null);
    }
  };

  // 2D PROOF — the same back-of-house deterministic composer RevisionStudio uses
  // (api/compose-2d-proof). It places the ACTUAL render views into the WePrintWraps
  // production-proof sheet with code-drawn text — ZERO Gemini, so it can't drift.
  // We pass the WPW shop name explicitly so compose-2d-proof keys its isWpw branding
  // (WePrintWraps header + signature footer). Saved as render_urls.production_proof
  // so it shows in the Design Assets card and is the FIRST proof we send.
  // Generate the flat master ARTBOARD from the approved 2D production proof —
  // flattens the design into print panels (no re-render, no full regen). Saves
  // master_artboard to the active version + metadata so it shows in Design Assets.
  const handleGenerateArtboard = async () => {
    if (!selected || !activeVersion?.id) return;
    const ru = (activeVersion.render_urls || {}) as Record<string, string>;
    const proofUrl = ru.production_proof || ru.proof_2d;
    if (!proofUrl) {
      toast({ title: "Generate the 2D proof first", description: "The artboard is flattened from the 2D production proof — make that first.", variant: "destructive" });
      return;
    }
    setArtboardBusy(true);
    try {
      // SANCTIONED artboard producer (Trish 2026-07-24): auto-generate-artboard
      // fed the 2D proof — the same step-6 call DesignPro generation fires.
      // Replaces generate-artboard-from-proof, the DEAD pipeline that cropped
      // the truck-render proof into WRONG CROPS (roadmap #5: retire on sight).
      const genId = (selected as any).source_visualization_id || (selected.metadata as any)?.autogen_visualization_id || null;
      const { data, error } = await supabase.functions.invoke("auto-generate-artboard", {
        body: {
          vehicleYear: selected.vehicle_year || undefined,
          vehicleMake: selected.vehicle_make || undefined,
          vehicleModel: selected.vehicle_model || undefined,
          finish: "Gloss",
          allViewUrls: activeVersion.render_urls || {},
          visualizationId: genId,
          designiqGenerationId: genId,
          skipProofGeneration: true,
          flatProofUrl: proofUrl, // artboard derives from the approved 2D proof
        },
      });
      const artboardUrl = (data as any)?.artboard_url || (data as any)?.artboardUrl || (data as any)?.url;
      if (error || !artboardUrl) {
        toast({ title: "Artboard generation failed", description: (data as any)?.error || error?.message || "Try again", variant: "destructive" });
        return;
      }
      const newRu: Record<string, string> = { ...(activeVersion.render_urls || {}), master_artboard: artboardUrl };
      await supabase.from("proof_versions" as any).update({ render_urls: newRu }).eq("id", activeVersion.id);
      const md = { ...((selected.metadata as any) || {}), master_artboard_url: artboardUrl };
      await supabase.from("proof_approvals" as any).update({ metadata: md }).eq("id", selected.id);
      setActiveVersion({ ...activeVersion, render_urls: newRu } as ActiveVersion);
      setAllVersions((vs) => vs.map((v) => (v.id === activeVersion.id ? { ...v, render_urls: newRu } : v)));
      toast({ title: "Artboard generated", description: "Flat master artboard saved to Design Assets." });
      refreshSelected();
    } catch (e: any) {
      toast({ title: "Artboard error", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setArtboardBusy(false);
    }
  };

  const handleGenerate2DProof = async () => {
    if (!selected || !activeVersion?.id) return;
    setProof2dBusy(true);
    try {
      const genId = (selected as any).source_visualization_id || (selected.metadata as any)?.autogen_visualization_id || undefined;
      const vehicleName = [selected.vehicle_year, selected.vehicle_make, selected.vehicle_model].filter(Boolean).join(" ");
      // Force WePrintWraps branding headers (compose-2d-proof detects isWpw from shopName).
      const shopName = (selected.metadata as any)?.shop_name || "WePrintWraps";
      const designName = (selected.metadata as any)?.design_name || "Design";
      const body = {
        generation_id: genId,
        view_urls: activeVersion.render_urls,
        shopName, vehicleName, designName, finish: "Gloss",
      };
      const resp = await fetch("https://www.restyleproai.com/api/compose-2d-proof", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await resp.json().catch(() => ({}));
      const proofUrl = j?.proofUrl || j?.url;
      if (!resp.ok || !proofUrl) {
        toast({ title: "2D proof failed", description: j?.error || "Composer returned no URL", variant: "destructive" });
        return;
      }
      const ru: Record<string, string> = { ...(activeVersion.render_urls || {}), production_proof: proofUrl };
      const { error } = await supabase.from("proof_versions" as any).update({ render_urls: ru }).eq("id", activeVersion.id);
      if (error) { toast({ title: "Saved proof, DB update failed", description: error.message, variant: "destructive" }); }
      setActiveVersion({ ...activeVersion, render_urls: ru } as ActiveVersion);
      setAllVersions((vs) => vs.map((v) => (v.id === activeVersion.id ? { ...v, render_urls: ru } : v)));
      toast({ title: "WePrintWraps 2D proof ready", description: "Composed + saved — it's the first proof to send." });
    } catch (e: any) {
      toast({ title: "2D proof error", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setProof2dBusy(false);
    }
  };

  // PRODUCTION ARTBOARD SHEET — the Summit-grade print spec sheet (all panels at
  // actual size + true dimension labels, 2" bleed, 300 DPI/CMYK header, dimensions
  // reference, production notes, auto-extracted color legend). Deterministic Sharp
  // composer (api/compose-production-artboard) — the frame is code-drawn, never AI.
  const handleGenerateProductionSheet = async () => {
    if (!selected || !activeVersion?.id) return;
    setProdSheetBusy(true);
    try {
      const genId = (selected as any).source_visualization_id || (selected.metadata as any)?.autogen_visualization_id || undefined;
      const vehicleName = [selected.vehicle_year, selected.vehicle_make, selected.vehicle_model].filter(Boolean).join(" ");
      const companyName = (selected.metadata as any)?.company_name || (selected as any).design_name || "";
      // True PVO panel dimensions — same vehicle-lookup autogen uses for the 2D
      // proof. Maps snake_case (side_w…) to the camelCase the composer wants so
      // the Dimensions Reference + per-panel labels show real sizes.
      let dimensions: Record<string, number> | undefined;
      if (selected.vehicle_make && selected.vehicle_model) {
        try {
          const { data: vj } = await supabase.functions.invoke("vehicle-lookup", {
            body: { make: selected.vehicle_make, model: selected.vehicle_model, year: selected.vehicle_year || "" },
          });
          const v: any = (vj as any)?.vehicle;
          if (v && (v.side_w || v.sideW)) {
            dimensions = {
              sideW: v.side_w ?? v.sideW, sideH: v.side_h ?? v.sideH,
              hoodW: v.hood_w ?? v.hoodW, hoodL: v.hood_l ?? v.hoodL,
              roofW: v.roof_w ?? v.roofW, roofL: v.roof_l ?? v.roofL,
              backW: v.back_w ?? v.backW, backH: v.back_h ?? v.backH,
              totalSqFt: v.total_sq_ft ?? v.totalSqFt,
            };
          }
        } catch { /* non-fatal — sheet still composes without dims */ }
      }
      const resp = await fetch("https://www.restyleproai.com/api/compose-production-artboard", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generation_id: genId, view_urls: activeVersion.render_urls, vehicleName, companyName, dimensions }),
      });
      const j = await resp.json().catch(() => ({}));
      const url = j?.url;
      if (!resp.ok || !url) {
        toast({ title: "Production sheet failed", description: j?.error || "Composer returned no URL", variant: "destructive" });
        return;
      }
      const ru: Record<string, string> = { ...(activeVersion.render_urls || {}), production_artboard: url };
      await supabase.from("proof_versions" as any).update({ render_urls: ru }).eq("id", activeVersion.id);
      setActiveVersion({ ...activeVersion, render_urls: ru } as ActiveVersion);
      setAllVersions((vs) => vs.map((v) => (v.id === activeVersion.id ? { ...v, render_urls: ru } : v)));
      window.open(url, "_blank");
      toast({ title: "Production artboard sheet ready", description: "Opened in a new tab + saved on the order." });
    } catch (e: any) {
      toast({ title: "Production sheet error", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setProdSheetBusy(false);
    }
  };

  // WIPE — admin "start fresh": delete EVERY version/render for this order and
  // reset the autogen flag so the next GO rebuilds from a clean slate. Destructive
  // + confirmed. (proof_versions is deletable; needs admin RLS delete — if it's
  // blocked the toast says so.)
  const handleWipeVersions = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete ALL ${allVersions.length} render version(s) for this order and start fresh? This cannot be undone.`)) return;
    setWiping(true);
    try {
      const { error: delErr } = await supabase.from("proof_versions" as any).delete().eq("proof_id", selected.id);
      if (delErr) {
        toast({ title: "Wipe failed", description: `${delErr.message} (admin delete permission may be required)`, variant: "destructive" });
        return;
      }
      const md: any = { ...(selected.metadata as any) };
      delete md.autogen_status;
      await supabase.from("proof_approvals" as any)
        .update({ metadata: md, source_visualization_id: null, design_name: null })
        .eq("id", selected.id);
      setActiveVersion(null);
      setAllVersions([]);
      setHeroOverrideUrl(null);
      toast({ title: "Wiped — clean slate", description: "All versions deleted. Press GO to generate fresh." });
      await refreshSelected();
    } catch (e: any) {
      toast({ title: "Wipe error", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setWiping(false);
    }
  };

  // Delete JUST the master artboard (DesignProAI-made) — admin can drop a bad
  // artboard without wiping the whole order. Clears it from the active version's
  // render_urls + the proof metadata.
  const handleDeleteArtboard = async () => {
    if (!selected) return;
    if (!window.confirm("Delete the master artboard for this order? (The 3D views stay.)")) return;
    try {
      if (activeVersion?.id) {
        const ru: Record<string, string> = { ...(activeVersion.render_urls || {}) };
        delete ru.master_artboard;
        await supabase.from("proof_versions" as any).update({ render_urls: ru }).eq("id", activeVersion.id);
        setActiveVersion({ ...activeVersion, render_urls: ru } as ActiveVersion);
      }
      const md: any = { ...(selected.metadata as any) };
      delete md.master_artboard_url;
      await supabase.from("proof_approvals" as any).update({ metadata: md }).eq("id", selected.id);
      toast({ title: "Artboard deleted", description: "Master artboard removed. Regenerate to rebuild it." });
      await refreshSelected();
    } catch (e: any) {
      toast({ title: "Couldn't delete artboard", description: e?.message || "Try again", variant: "destructive" });
    }
  };

  // Delete JUST the 2D production proof (the WPW-branded dimensioned sheet) from
  // the active version — admin can drop a WRONG / mislabeled 2D proof without
  // wiping the order or the 3D views. Clears production_proof + proof_2d from the
  // active version's render_urls. Regenerate rebuilds it.
  const handleDelete2DProof = async () => {
    if (!selected) return;
    if (!activeVersion?.id) {
      toast({ title: "No active version", description: "Nothing to delete on this order yet.", variant: "destructive" });
      return;
    }
    if (!window.confirm("Delete the 2D production proof for this order? (The 3D views and artboard stay — you can regenerate the 2D proof after.)")) return;
    try {
      const ru: Record<string, string> = { ...(activeVersion.render_urls || {}) };
      delete ru.production_proof;
      delete ru.proof_2d;
      const { error } = await supabase.from("proof_versions" as any).update({ render_urls: ru }).eq("id", activeVersion.id);
      if (error) {
        toast({ title: "Couldn't delete 2D proof", description: `${error.message} (admin permission may be required)`, variant: "destructive" });
        return;
      }
      setActiveVersion({ ...activeVersion, render_urls: ru } as ActiveVersion);
      toast({ title: "2D proof deleted", description: "The wrong 2D proof was removed. Regenerate to rebuild it." });
      await refreshSelected();
    } catch (e: any) {
      toast({ title: "Couldn't delete 2D proof", description: e?.message || "Try again", variant: "destructive" });
    }
  };

  // IMPORT the correct design from Revision Studio — paste a /revision-studio
  // link (or a bare visualization UUID) and we set THAT design as this proof's
  // active version. Uses the proven AttachDesignDialog mechanism
  // (proof-save-version + proof_approvals.source_visualization_id), so AI revise
  // / version history / search all light up and it works under RLS for admins.
  const importFromRevisionStudio = async () => {
    if (!selected) return;
    const m = String(importInput || "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (!m) {
      toast({ title: "Couldn't read that", description: "Paste a Revision Studio link or visualization ID", variant: "destructive" });
      return;
    }
    const uuid = m[0];
    setImporting(true);
    try {
      // 1. Resolve the visualization — try color_visualizations directly first.
      let { data: viz } = await supabase
        .from("color_visualizations" as any)
        .select("id, render_urls, admin_notes, custom_design_url")
        .eq("id", uuid)
        .maybeSingle();
      // Not a viz id? Maybe it's a proof id — follow its source_visualization_id.
      if (!viz) {
        const { data: pr } = await supabase
          .from("proof_approvals" as any)
          .select("source_visualization_id")
          .eq("id", uuid)
          .maybeSingle();
        const srcId = (pr as any)?.source_visualization_id;
        if (srcId) {
          const { data: viz2 } = await supabase
            .from("color_visualizations" as any)
            .select("id, render_urls, admin_notes, custom_design_url")
            .eq("id", srcId)
            .maybeSingle();
          viz = viz2 as any;
        }
      }
      if (!viz) {
        toast({ title: "Design not found", description: "No visualization (or proof) matched that ID. Double-check the link.", variant: "destructive" });
        return;
      }
      const vizId = (viz as any).id as string;

      // 2. Build render_urls from the viz, resolving the 2D proof url.
      const render_urls: Record<string, string> = { ...(((viz as any).render_urls as Record<string, string>) || {}) };
      let proofUrl: string | null = null;
      const an = (viz as any).admin_notes;
      let notes: any = null;
      try { notes = typeof an === "string" ? JSON.parse(an) : an; } catch { notes = null; }
      proofUrl = notes?.flat_proof_url || render_urls.production_proof || null;
      if (proofUrl) render_urls.production_proof = proofUrl;
      // Ensure the card has a thumbnail.
      if (!render_urls.hero && render_urls.side) render_urls.hero = render_urls.side;

      // 3. Save it as the proof's active version (same as AttachDesignDialog).
      const { data, error } = await supabase.functions.invoke("proof-save-version", {
        body: { proof_id: selected.id, render_urls, shop_message: "Imported correct design from Revision Studio" },
        headers: { "Idempotency-Key": `import-${selected.id}-${vizId}-${Date.now()}` },
      });
      if (error || !(data as any)?.success) {
        let msg = (data as any)?.error || error?.message || "Import failed";
        const ctx = (error as any)?.context;
        if (ctx && typeof ctx.json === "function") {
          try { const b = await ctx.json(); if (b?.error) msg = b.error; } catch { /* keep generic */ }
        }
        throw new Error(msg);
      }
      // 4. Link the design to the order so AI revise / search / history work.
      await supabase
        .from("proof_approvals" as any)
        .update({ source_visualization_id: vizId })
        .eq("id", selected.id);
      toast({ title: "Design imported", description: "It's now the proof's active version — ready to send or AI-revise." });
      setImportOpen(false);
      setImportInput("");
      await refreshSelected();
    } catch (e: any) {
      toast({ title: "Couldn't import", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  // USE a saved version — non-destructive: make any prior version the active one
  // (black, white, any iteration), keeping the full saved history with its
  // instruction + date. Reuses proof-revert-version (same as the timeline).
  const [usingVersionId, setUsingVersionId] = useState<string | null>(null);
  // "Send both colorways" — stitch the 2 most recent versions into one labeled
  // comparison image so the customer sees black + white in a single proof.
  const [bothBusy, setBothBusy] = useState(false);
  const handleSendBothVersions = async () => {
    if (!selected || allVersions.length < 2) {
      toast({ title: "Need two versions", description: "Generate a second colorway first (e.g. Revise to white), then both will be here.", variant: "destructive" });
      return;
    }
    setBothBusy(true);
    try {
      // Pick the actual WHITE and BLACK colorways (by prompt), newest of each —
      // NOT just the two most-recent versions (which can both be black). Falls
      // back to the two most recent only if we can't find a white/black pair.
      const hero = (v: any) => { const ru: any = v.render_urls || {}; return ru.hero || ru.side || ru["driver-side"] || ru["passenger-side"] || null; };
      const byNew = [...allVersions].sort((a, b) => b.version_number - a.version_number);
      const white = byNew.find((v) => /\bwhite\b/.test(String(v.prompt_text || "").toLowerCase()) && hero(v));
      const black = byNew.find((v) => /\bblack\b/.test(String(v.prompt_text || "").toLowerCase()) && hero(v));
      const chosen = (white && black) ? [white, black] : byNew.filter(hero).slice(0, 2);
      const panels = chosen.map((v) => {
        const t = String(v.prompt_text || "").toLowerCase();
        const label = /\bwhite\b/.test(t) ? "WHITE VERSION" : /\bblack\b/.test(t) ? "BLACK VERSION" : `Version ${v.version_number}`;
        return { label, url: hero(v) };
      }).filter((p) => p.url);
      if (panels.length < 2) {
        toast({ title: "Couldn't find both renders", description: "One version has no usable render.", variant: "destructive" });
        return;
      }
      const genId = (selected as any).source_visualization_id || (selected.metadata as any)?.autogen_visualization_id || undefined;
      const resp = await fetch("https://www.restyleproai.com/api/compose-colorway-compare", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generation_id: genId, panels }),
      });
      const j = await resp.json().catch(() => ({}));
      const url = j?.url;
      if (!resp.ok || !url) {
        toast({ title: "Compare failed", description: j?.error || "Composer returned no URL", variant: "destructive" });
        return;
      }
      if (activeVersion?.id) {
        const ru: Record<string, string> = { ...(activeVersion.render_urls || {}), colorway_compare: url };
        await supabase.from("proof_versions" as any).update({ render_urls: ru }).eq("id", activeVersion.id);
        setActiveVersion({ ...activeVersion, render_urls: ru } as ActiveVersion);
      }
      window.open(url, "_blank");
      toast({ title: "Both colorways combined", description: `${(j.colorways || []).join(" + ")} — saved to the proof. Now Send proof to customer and he sees both.` });
    } catch (e: any) {
      toast({ title: "Compare error", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setBothBusy(false);
    }
  };

  const handleUseVersion = async (versionId: string) => {
    if (!selected) return;
    setUsingVersionId(versionId);
    try {
      const { data, error } = await supabase.functions.invoke("proof-revert-version", {
        body: { proof_id: selected.id, target_version_id: versionId },
      });
      if (error || !(data as any)?.success) {
        toast({ title: "Couldn't switch version", description: (data as any)?.error || error?.message || "Try again", variant: "destructive" });
      } else {
        toast({ title: "Now using this version", description: `Showing v${(data as any).active_version_number}. Nothing was deleted.` });
        await refreshSelected();
      }
    } finally {
      setUsingVersionId(null);
    }
  };

  // Delete ONE bad version (tiny hover-X) so it never corrupts the history.
  // The active version is protected (switch to another first).
  const handleDeleteVersion = async (versionId: string, vnum: number, isActive: boolean) => {
    if (!selected) return;
    const others = allVersions.filter((v) => v.id !== versionId);
    if (isActive && others.length === 0) {
      toast({ title: "Can't delete the only version", description: "This is the last version. Generate another first, then delete this one.", variant: "destructive" });
      return;
    }
    if (!window.confirm(`Delete v${vnum}? Removes just this one version (the others stay). Cannot be undone.`)) return;
    setUsingVersionId(versionId);
    try {
      const { error } = await supabase.from("proof_versions" as any).delete().eq("id", versionId);
      if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
      setAllVersions((vs) => vs.filter((v) => v.id !== versionId));
      // If we deleted the ACTIVE version, promote the newest remaining one so the
      // order always has an active design (no blank state).
      if (isActive && others.length > 0) {
        const newest = [...others].sort((a, b) => b.version_number - a.version_number)[0];
        await supabase.from("proof_versions" as any).update({ is_active: true }).eq("id", newest.id);
        setAllVersions((vs) => vs.map((v) => (v.id === newest.id ? { ...v, is_active: true } : v)));
        toast({ title: `v${vnum} deleted`, description: `Now showing v${newest.version_number}.` });
        await refreshSelected();
      } else {
        toast({ title: `v${vnum} deleted`, description: "The other versions are untouched." });
      }
    } catch (e: any) {
      toast({ title: "Delete error", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setUsingVersionId(null);
    }
  };

  // GO — run the A.C.E agent: it parses the order and either creates the design
  // in DesignPro (brief present) or emails the missing-instructions + portal
  // link (brief missing). Forwards the user's session for the render pipeline.
  // Works on the open order or any row (pass a proofId).
  const [goingId, setGoingId] = useState<string | null>(null);
  const handleAgentGo = async (proofId?: string, opts?: { force?: boolean }) => {
    // Guard: if this is wired straight to an onClick/onGo, React passes the
    // click event here. Stringifying that event into the invoke body throws
    // "Converting circular structure to JSON" and the request never leaves the
    // browser (red "GO failed" flash). Only accept a real string proof id.
    const pid = typeof proofId === "string" && proofId ? proofId : undefined;
    const id = pid || selected?.id;
    if (!id) return;
    // CAPTURE THE TYPED EDIT FIRST — anything in the A.C.E box is the admin's
    // instruction ("add the three sponsor logos to the doors"). Persist it as
    // manual_prompt BEFORE we route so EVERY GO entry point (the box's GO, the
    // "Run A.C.E" menu, regenerate) honors it — and an order that already has a
    // design REVISES instead of dead-ending on "proof is already with the
    // customer". The surgical revision path + agent-go both read manual_prompt.
    if (!pid && id === selected?.id) {
      const typed = aceBrief.trim();
      const md0 = (selected?.metadata as any) || {};
      if (typed && typed !== md0.manual_prompt) {
        const newMeta = { ...md0, manual_prompt: typed };
        await supabase.from("proof_approvals" as any).update({ metadata: newMeta }).eq("id", id);
        setRows((prev) => (prev || []).map((p) => p.id === id ? { ...p, metadata: newMeta } : p));
        setAceBrief(""); // submitted — clear the box so a later GO doesn't re-apply it
      }
    }
    // ADMIN REGENERATE: agent-go no-ops on a finished order ("Nothing to run"),
    // but as admin you often catch an issue (bad roof, wrong color) and need a
    // fresh render BEFORE the client sees it. So if the OPEN order already has a
    // done design, GO = regenerate: clear the stuck flag + re-run autogen directly.
    if (!pid && selected?.id === id && (selected?.metadata as any)?.autogen_status === "done") {
      await handleGenerate3DProof();
      return;
    }
    setGoingId(id);
    if (!pid) setBusyAction("agent-go");
    try {
      // force=true → re-design even if a version already exists (the design team
      // added a fresh prompt / new reference and wants a new version iteration).
      const { data, error } = await supabase.functions.invoke("approvepro-agent-go", { body: { proof_id: id, force: opts?.force || undefined } });
      if (error || !(data as any)?.ok) {
        toast({ title: "GO failed", description: (data as any)?.error || error?.message || "Try again", variant: "destructive" });
      } else {
        // Be honest about no-op results: a revoked/terminal order or an
        // already-invited one is not "A.C.E is on it" — say what actually happened.
        const action = (data as any)?.action;
        const noop = action === "none" || action === "already_requested" || action === "ready" || action === "sent";
        toast({
          title: noop ? "Nothing to run" : "A.C.E is on it 🚀",
          description: (data as any).message,
          ...(action === "none" ? { variant: "destructive" as const } : {}),
        });
        if (id === selected?.id) await refreshSelected();
        loadList();
      }
    } finally {
      setGoingId(null);
      setBusyAction(null);
    }
  };

  // Upload operator-supplied reference art straight onto the work order. Files
  // land in the public wrap-files bucket and are appended to customer_uploads,
  // so they show in the references grid AND feed A.C.E as exact_reference —
  // i.e. press GO and the job recreates them (RecreatePro), with the typed
  // context applied as edits.
  const handleAceUpload = async (files: FileList | null) => {
    if (!selected || !files || files.length === 0) return;
    setAceUploading(true);
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `approvepro-context/${selected.id}/${Date.now()}_${safe}`;
        const { error: upErr } = await supabase.storage.from("wrap-files").upload(path, file, { contentType: file.type, upsert: true });
        if (upErr) { toast({ title: "Upload failed", description: upErr.message, variant: "destructive" }); continue; }
        const { data: pub } = supabase.storage.from("wrap-files").getPublicUrl(path);
        if (pub?.publicUrl) urls.push(pub.publicUrl);
      }
      if (urls.length === 0) return;
      const md = (selected.metadata || {}) as any;
      const merged = [...(Array.isArray(md.customer_uploads) ? md.customer_uploads : []), ...urls];
      const newMeta = { ...md, customer_uploads: merged };
      const { error } = await supabase.from("proof_approvals" as any).update({ metadata: newMeta }).eq("id", selected.id);
      if (error) { toast({ title: "Couldn't attach", description: error.message, variant: "destructive" }); return; }
      setRows((prev) => (prev || []).map((p) => p.id === selected.id ? { ...p, metadata: newMeta } : p));
      toast({ title: `Added ${urls.length} reference${urls.length === 1 ? "" : "s"}`, description: "Press GO — A.C.E will recreate from these (RecreatePro)." });
      await refreshSelected();
    } finally {
      setAceUploading(false);
      if (aceFileInputRef.current) aceFileInputRef.current.value = "";
    }
  };

  // Save the typed context as the brief, then press GO. A.C.E then decides:
  // references attached → RecreatePro (recreate), text only → DesignPro (design).
  const handleSaveContextAndGo = async () => {
    if (!selected) return;
    // The typed A.C.E instruction is captured as manual_prompt inside
    // handleAgentGo (so every GO entry point honors it and an order that already
    // has a design REVISES instead of dead-ending on "proof is already with the
    // customer"). handleAgentGo then routes: existing design → surgical revision,
    // no design yet → first-time DesignPro generation.
    await handleAgentGo();
  };

  const handleRevoke = async () => {
    if (!selected) return;
    if (!confirm("Revoke this proof? The customer's link stops working immediately.")) return;
    setBusyAction("revoke");
    try {
      const { data, error } = await supabase.functions.invoke("proof-revoke", {
        body: { proof_id: selected.id },
      });
      if (error || !data?.success) {
        toast({
          title: "Revoke failed",
          description: (data as any)?.error || error?.message || "Failed",
          variant: "destructive",
        });
      } else {
        toast({ title: "Revoked" });
        await refreshSelected();
      }
    } finally {
      setBusyAction(null);
    }
  };

  // Send the branded "add your design info" portal email on demand (the backfill
  // button — start with any order). force:true so it re-sends even if one already
  // went out automatically. kind="request" asks for details; "greeting" welcomes.
  const handleSendPortalEmail = async (kind: "request" | "greeting") => {
    if (!selected) return;
    const md = (selected.metadata || {}) as any;
    const wooOrderId = md.wpw_woo_order_id || md.wpw_order_number || md.woo_order_id || md.woo_order_number || undefined;
    setBusyAction("portal-email");
    try {
      const { data, error } = await supabase.functions.invoke("request-order-instructions", {
        body: {
          to: selected.customer_email,
          customerName: selected.customer_name || undefined,
          orderNumber: md.wpw_order_number || md.wpw_woo_order_id || undefined,
          vehicle: [selected.vehicle_year, selected.vehicle_make, selected.vehicle_model].filter(Boolean).join(" ") || undefined,
          isWpw: isRealWpwOrder(selected),
          kind,
          wooOrderId,
          force: true,
        },
      });
      if (error || !(data as any)?.ok) {
        toast({ title: "Couldn't send portal email", description: (data as any)?.error || error?.message || "Failed", variant: "destructive" });
      } else {
        toast({
          title: kind === "greeting" ? "Greeting sent" : "Portal email sent",
          description: `Emailed ${selected.customer_email} a branded link to ${kind === "greeting" ? "track their order" : "add their design info"}.`,
        });
        await refreshSelected();
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleCopyLink = async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(`${getPublicBase()}/approve/${selected.view_token}`);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const startEditCustomer = () => {
    if (!selected) return;
    setCustomerNameDraft(selected.customer_name || "");
    setCustomerEmailDraft(selected.customer_email);
    setCustomerPhoneDraft(selected.customer_phone || "");
    setEditingCustomer(true);
  };

  const handleSaveCustomer = async () => {
    if (!selected) return;
    const email = customerEmailDraft.trim();
    if (!email || !email.includes("@")) {
      toast({ title: "Email looks wrong", description: "Customer email must be a valid address.", variant: "destructive" });
      return;
    }
    setSavingCustomer(true);
    try {
      const patch: any = {
        customer_email: email,
        customer_name: customerNameDraft.trim() || null,
        customer_phone: customerPhoneDraft.trim() || null,
      };
      const { error } = await supabase
        .from("proof_approvals" as any)
        .update(patch)
        .eq("id", selected.id);
      if (error) {
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Customer updated", description: `Now sending to ${email}` });
      setRows((prev) => (prev || []).map((p) =>
        p.id === selected.id ? { ...p, ...patch } : p,
      ));
      setEditingCustomer(false);
    } finally {
      setSavingCustomer(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!selected) return;
    setSavingNotes(true);
    try {
      const { error } = await supabase
        .from("proof_approvals" as any)
        .update({ internal_notes: notesDraft } as any)
        .eq("id", selected.id);
      if (error) {
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Notes saved" });
      setRows((prev) => (prev || []).map((p) =>
        p.id === selected.id ? { ...p, internal_notes: notesDraft } : p,
      ));
    } finally {
      setSavingNotes(false);
    }
  };

  // Save the message that goes in the customer's proof email.
  // proof-send reads message_to_customer from the row when no
  // custom_message is passed in the body, so saving here means the
  // next Send / Resend includes it automatically.
  const handleSaveMessage = async () => {
    if (!selected) return;
    setSavingMessage(true);
    try {
      const { error } = await supabase
        .from("proof_approvals" as any)
        .update({ message_to_customer: messageDraft } as any)
        .eq("id", selected.id);
      if (error) {
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Customer message saved" });
      setRows((prev) => (prev || []).map((p) =>
        p.id === selected.id ? { ...p, message_to_customer: messageDraft } : p,
      ));
    } finally {
      setSavingMessage(false);
    }
  };

  const handleSendReply = async () => {
    if (!selected || !replyMessage.trim()) return;
    setSendingReply(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // Send email to customer
      const { error: emailErr } = await supabase.functions.invoke("send-client-proof-email", {
        body: {
          to: selected.customer_email,
          cc: user?.email || undefined,
          clientName: selected.customer_name || selected.customer_email.split("@")[0],
          subject: `Re: Your Design Proof — ${selected.design_name || "Vehicle Wrap"}`,
          body: replyMessage,
          emailType: "proof",
          vehicleInfo: {
            year: selected.vehicle_year || undefined,
            make: selected.vehicle_make || undefined,
            model: selected.vehicle_model || undefined,
          },
          views: hero ? [{ type: "hero", url: hero, label: "Current Design" }] : [],
          proofPdfUrl: undefined,
        },
      });
      if (emailErr) throw new Error(emailErr.message || "Email send failed");

      // Log to proof_events
      const svc = supabase;
      await svc.from("proof_events" as any).insert({
        proof_id: selected.id,
        event_type: "shop_reply",
        actor_role: "shop",
        actor_user_id: user?.id || null,
        payload: { message: replyMessage, sent_to: selected.customer_email },
      } as any);

      toast({ title: "Reply sent", description: `Message emailed to ${selected.customer_email}` });
      setReplyMessage("");
      setShowReply(false);

      // Refresh events
      const { data: events } = await supabase
        .from("proof_events" as any)
        .select("event_type, actor_role, payload, created_at")
        .eq("proof_id", selected.id)
        .in("event_type", ["instructions_requested", "customer_reply", "customer_comment", "version_saved", "shop_reply", "revision_requested", "line_item_decision", "sent", "resent", "signed", "declined", "send_failed", "email_sent"])
        .order("created_at", { ascending: true });
      setReplyEvents((events || []) as any);
    } catch (err: any) {
      toast({ title: "Reply failed", description: err.message, variant: "destructive" });
    } finally {
      setSendingReply(false);
    }
  };

  // Ask Claude (draft-reply edge function) for a ready-to-send reply built from
  // the order context + the conversation so far. Drops the result into the
  // composer for the designer to review/edit before sending.
  const handleDraftReply = async () => {
    if (!selected) return;
    const hadText = replyMessage.trim().length > 0;
    setDraftingReply(true);
    try {
      const thread = (replyEvents || [])
        .map((ev) => {
          const text =
            ev.payload?.message ||
            ev.payload?.change_request ||
            ev.payload?.decline_reason ||
            (ev.event_type === "instructions_requested"
              ? "We asked the customer for their project details and artwork."
              : "");
          if (!text) return null;
          const who =
            ev.actor_role === "customer" ? "customer" : ev.actor_role === "system" ? "system" : "shop";
          return { who, text };
        })
        .filter(Boolean);

      const { data, error } = await supabase.functions.invoke("draft-reply", {
        body: {
          customerName: selected.customer_name || undefined,
          orderNumber:
            selected.metadata?.wpw_woo_order_number ||
            selected.metadata?.wpw_woo_order_id ||
            undefined,
          vehicle: [selected.vehicle_year, selected.vehicle_make, selected.vehicle_model]
            .filter(Boolean)
            .join(" ") || undefined,
          needsInstructions: thread.length === 0,
          thread,
          // When the designer has typed shorthand, AI REWRITES it (preserving
          // their facts). When empty, AI drafts a reply from context.
          draft: replyMessage.trim() || undefined,
        },
      });
      if (error) throw new Error(error.message || "Draft failed");
      if (data?.error) throw new Error(data.error);
      const draft = (data?.draft || "").trim();
      if (!draft) throw new Error("No draft returned");
      setReplyMessage(draft);
      toast({
        title: hadText ? "Rewritten" : "Draft ready",
        description: hadText
          ? "Polished your message — review and edit before sending."
          : "Review and edit before sending.",
      });
    } catch (err: any) {
      toast({ title: "Couldn't draft reply", description: err.message, variant: "destructive" });
    } finally {
      setDraftingReply(false);
    }
  };

  // ── Render ─────────────────────────────────────────────
  const vehicleOf = (r: ProofRow) =>
    [r.vehicle_year, r.vehicle_make, r.vehicle_model].filter(Boolean).join(" ");
  // Only show the big hero when it's real artwork — a designer-uploaded
  // version, an AI revision, or a customer reference upload. Auto-ingested
  // WPW drafts (created_by_role === "system_upload") with no uploads fall
  // back to the WooCommerce product thumbnail (e.g. the "Hourly Design"
  // stock banner), which is pointless to blow up full-width. Suppress it so
  // the compact "no design yet" placeholder shows instead.
  // The hero is ONLY a render WE made. The customer's uploaded design example
  // (a weprintwraps.com extra-product-options URL) and the stock product
  // thumbnail are NOT our proof — they show in the Work Order as references.
  const hero = realRenderUrl(activeVersion);
  const displayHero = heroOverrideUrl || hero;

  // ── At-a-glance derivations for the Order Command Header ──────────────────
  // The most recent customer message (so "last from customer" is one glance,
  // not a tab dig). Same payload fields the reply-thread builder reads.
  const lastCustomerMsg = (() => {
    const msgs = (replyEvents || [])
      .filter((ev) => ev.actor_role === "customer")
      .map((ev) => ({
        text: ev.payload?.message || ev.payload?.change_request || ev.payload?.decline_reason || ev.payload?.comment || "",
        at: ev.created_at,
      }))
      .filter((m) => m.text);
    return msgs.sort((a, b) => +new Date(b.at) - +new Date(a.at))[0] || null;
  })();
  // The latest version (newest version_number) + the prompt that created it, so
  // "last sent revision" is visible without opening the timeline.
  const sortedVersions = [...(allVersions || [])].sort((a, b) => (b.version_number || 0) - (a.version_number || 0));
  const latestVersion = sortedVersions[0] || null;
  const revisionCount = sortedVersions.length;
  const uploadsCount = (((selected?.metadata as any)?.customer_uploads) || []).length;
  const hasDesign = !!hero;
  // Canonical design generation id for THIS order — RestylePro-native designs set
  // source_visualization_id; WPW/autogen jobs set metadata.autogen_visualization_id.
  // Used to gate + feed the Design Assets section and the Panel Studio deep-link so
  // tenant jobs aren't hidden.
  const sotGenId = ((selected as any)?.source_visualization_id) || ((selected?.metadata as any)?.autogen_visualization_id) || null;

  return (
    <div className="min-h-screen bg-gray-200 pb-8 text-gray-900" style={{ scrollbarGutter: "stable" }}>
      <Helmet>
        <title>ApprovePro™ · RestylePro</title>
      </Helmet>

      <header>
        <div className="h-1 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />
        <div className="bg-white border-b border-gray-200">
        <div className="max-w-[1500px] mx-auto px-4 py-5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <TooltipProvider delayDuration={120}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-4 cursor-help">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#3b82f6] via-[#8b5cf6] to-[#ec4899] flex items-center justify-center shrink-0 shadow-md ring-1 ring-black/5">
                      <ClipboardSignature className="w-9 h-9 text-white" />
                    </div>
                    <div>
                      <h1 className="text-3xl sm:text-4xl font-extrabold leading-none flex items-center gap-2">
                        <span className="text-gray-900">Approve</span>
                        <span className="bg-gradient-to-r from-[#3b82f6] via-[#8b5cf6] to-[#ec4899] bg-clip-text text-transparent">Pro</span>
                        <span className="text-gray-700 text-xl">™</span>
                        <Info className="w-4 h-4 text-gray-400 hover:text-gray-600" />
                      </h1>
                      <p className="text-base sm:text-lg text-gray-600 mt-1.5 font-semibold">
                        AI-first design, revision &amp; approval workbench
                      </p>
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="start" className="max-w-md p-3.5 bg-white border-gray-200 text-gray-900 shadow-lg">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-gray-800 font-semibold mb-1.5">
                    How it works
                  </div>
                  <div className="text-sm font-bold leading-tight mb-1.5">
                    Where designs become
                    <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent"> signed approvals</span>.
                  </div>
                  <p className="text-xs text-gray-600 leading-snug">
                    Pick a job from the rails on the left, send the customer a branded link, and watch the status update live as they sign, request revisions, or decline. Every email, every version, every change is logged automatically.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="flex items-center gap-2">
            {selected?.view_token && (
              <a
                href={`${getPublicBase()}/approve/${selected.view_token}`}
                target="_blank"
                rel="noreferrer"
                title="Open the customer-facing ApprovePro portal for the open order — exactly what the customer sees."
                className="inline-flex items-center h-11 px-5 text-[15px] gap-1.5 font-bold text-white hover:brightness-110 border-0 shadow-sm rounded-md"
                style={{ background: "linear-gradient(90deg,#0066cc,#00a8e8,#0080dd)" }}
              >
                <Eye className="w-5 h-5" />
                View This Customer's Portal
              </a>
            )}
            <Button
              onClick={() => setShowNewProof(true)}
              className="h-11 px-5 text-[15px] gap-1.5 font-bold bg-gradient-to-r from-[#3b82f6] via-[#8b5cf6] to-[#ec4899] text-white hover:brightness-110 border-0 shadow-sm"
            >
              <Plus className="w-5 h-5" />
              New Proof
            </Button>
            <Button variant="outline" onClick={loadList} className="h-11 px-4 text-[15px] gap-1.5 font-semibold border-gray-300 text-gray-700 hover:bg-gray-50">
              <RefreshCw className={cn("w-5 h-5", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>
        </div>

        {/* Big-format hero strip — gives the workbench a real identity and
            live counts so a designer landing here understands instantly:
            "this is ApprovePro, here's how many proofs are in flight."
            Sits BELOW the slim toolbar so the toolbar still has the New
            Proof / Refresh buttons but the page no longer feels nameless. */}
        {/* Mine / Unassigned filters live in the left column under the designer
            chips — no duplicate top strip, so the page sits higher. */}
      </header>

      <main className="max-w-[1500px] mx-auto px-4 py-3 space-y-4">
        {analyticsDrill && (
          <div className="flex items-center gap-2 rounded-lg border border-[#0080dd]/30 bg-[#0080dd]/5 px-3 py-2">
            <span className="text-[12px] font-semibold text-[#0369a1]">Showing: {analyticsDrill.label} ({filtered.length})</span>
            <button type="button" onClick={() => setAnalyticsDrill(null)} className="ml-auto text-[12px] font-semibold text-gray-500 hover:text-gray-800 underline">Clear</button>
          </div>
        )}

        {/* Split pane — ProductionFlow 3-column shell on wide screens */}
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] xl:grid-cols-[290px_minmax(0,1fr)_480px] gap-4">

          {/* LEFT — proof list */}
          <aside className="space-y-3">
            <Card className="p-3 space-y-2 bg-white border-gray-200">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-700" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search order #, customer, design, vehicle…"
                  className="pl-8 h-9 text-sm border-gray-200 bg-white text-gray-900"
                />
              </div>

              {/* DESIGN ORDERS header + count — real WPW design orders only
                  (scope is enforced; print/material + internal proofs never
                  appear). */}
              <div className="flex items-center justify-between pt-0.5">
                <span className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-gray-900">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                  Design Orders
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-gray-500">{filtered.length} shown</span>
                  {filtered.length > 0 && (
                    <button
                      type="button"
                      onClick={handleDeleteAllShown}
                      disabled={deletingProofs}
                      title="Delete every proof currently shown in the queue — clears bad/duplicate drafts in one shot. Cannot be undone."
                      className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-50 text-red-700 text-[10px] font-bold px-2 py-0.5 hover:bg-red-100 disabled:opacity-50"
                    >
                      {deletingProofs ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      Delete all shown
                    </button>
                  )}
                </div>
              </div>

              {/* Compact filters — month + designer as two dropdowns on one
                  row (replaces the sprawling name chips, frees vertical space
                  so the job cards sit higher). */}
              <div className="grid grid-cols-2 gap-1.5">
                <div className="flex items-center gap-1 min-w-0">
                  <CalendarDays className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                  <select
                    value={monthFilter}
                    onChange={(e) => setMonthFilter(e.target.value)}
                    className="h-8 w-full text-[12px] rounded-md border border-gray-200 bg-white text-gray-900 px-1.5"
                  >
                    <option value="all">All months</option>
                    {availableMonths.map((m) => (
                      <option key={m} value={m}>{monthLabel(m)}</option>
                    ))}
                  </select>
                </div>
                {designerScoped ? (
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-700">
                    <UserCheck className="w-3.5 h-3.5" /> My queue ({mineCount})
                  </div>
                ) : (
                  <div className="flex items-center gap-1 min-w-0">
                    <User className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                    <select
                      value={assigneeFilter}
                      onChange={(e) => setAssigneeFilter(e.target.value)}
                      title="Filter by designer"
                      className="h-8 w-full text-[12px] rounded-md border border-gray-200 bg-white text-gray-900 px-1.5"
                    >
                      <option value="all">All designers</option>
                      <option value="mine">Mine ({mineCount})</option>
                      <option value="unassigned">Unassigned · A.C.E ({unassignedActiveCount})</option>
                      {team.members.filter((m) => !m.isCurrentUser).map((m) => (
                        <option key={m.user_id} value={m.user_id}>{m.displayName}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
                <TabsList className="grid grid-cols-4 w-full h-8">
                  {FILTERS.map((f) => (
                    <TabsTrigger key={f.key} value={f.key} className="text-[11px] px-1">
                      {f.label}
                      <span className="ml-1 text-[10px] opacity-70">({counts[f.key] ?? 0})</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              {/* CHWD lane — isolate Custom Vehicle Wrap Design orders (the
                  full-wrap design jobs that feed the recreate/print path). */}
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setChwdOnly((v) => !v)}
                  aria-pressed={chwdOnly}
                  className={
                    chwdOnly
                      ? "inline-flex items-center gap-1.5 rounded-full px-3 h-7 text-[11px] font-bold text-white bg-gradient-to-r from-[#3b82f6] to-[#ec4899]"
                      : "inline-flex items-center gap-1.5 rounded-full px-3 h-7 text-[11px] font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 border border-gray-200"
                  }
                  title="Show only Custom Vehicle Wrap Design orders"
                >
                  <Sparkles className="w-3 h-3" />
                  CHWD only
                  <span className={chwdOnly ? "opacity-90" : "opacity-60"}>({chwdCount})</span>
                </button>
                {chwdOnly && (
                  <span className="text-[10px] text-gray-400">Custom Vehicle Wrap Design · spans all statuses</span>
                )}
              </div>
            </Card>

            <div className="space-y-2 max-h-[calc(100vh-260px)] overflow-y-auto pr-1">
              {loading && (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-900" />
                </div>
              )}
              {!loading && filtered.length === 0 && (
                <Card className="p-6 text-center text-sm text-gray-800 bg-white border-gray-200">
                  {rows && rows.length === 0
                    ? "No proofs yet. Click \"New Proof\" above or \"Send for Client Approval\" in any tool."
                    : "No proofs match this filter."}
                </Card>
              )}
              {filtered.map((r) => {
                const cfg = STATUS[r.status] || STATUS.draft;
                const Icon = cfg.icon;
                const isActive = r.id === selectedId;
                const isNew = isNewForUser(r.id, r.updated_at);
                const assignee = team.lookup(r.assigned_to);
                const orderNum =
                  r.metadata?.wpw_order_number ||
                  r.metadata?.wpw_woo_order_id ||
                  r.metadata?.woo_order_number ||
                  null;
                const isWpwOrigin = !!(r.metadata?.wpw_woo_order_id || r.metadata?.woo_order_id);
                // Design product type (for the label under the card thumbnail).
                const designLabel = (() => {
                  const items = r.metadata?.line_items;
                  if (!Array.isArray(items)) return null;
                  const ids = items.map((li: any) => String(li?.product_id));
                  if (ids.includes("234") || ids.includes("58160")) return "Custom Wrap Design";
                  // "Hourly Design" (290) label removed from cards per Trish.
                  if (ids.includes("289")) return "Output Fee";
                  return null;
                })();
                // Live agent state — the "christmas tree" tag + recommended action.
                const agent = computeAgentState(r, {
                  hasDesign: !!thumbMap[r.id] && !String(thumbMap[r.id] || "").includes("weprintwraps.com"),
                  orderDate: rowOrderDate(r),
                });
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    style={{ borderLeftColor: agent.dot }}
                    className={cn(
                      "w-full text-left rounded-lg border border-l-4 p-3 transition-colors relative",
                      isActive
                        ? "border-[#3b82f6] bg-[#3b82f6]/10 ring-1 ring-[#3b82f6]/30"
                        : "border-gray-200 bg-white hover:bg-gray-50",
                      agent.urgent && "ring-2 ring-red-400/70",
                    )}
                  >
                    {/* NEW pulse — proof has been updated since this user
                        opened it. Clears the moment they click in. */}
                    {isNew && !isActive && (
                      <span className="absolute -top-1 -right-1 inline-flex items-center justify-center">
                        <span className="relative rounded-full bg-orange-500 text-white text-[8px] font-bold px-1.5 py-0.5 leading-none">
                          NEW
                        </span>
                      </span>
                    )}
                    {/* Per-row delete — drop a bad/duplicate draft straight out of
                        the queue. role="button" (not a nested <button>) so the row
                        click still selects; stopPropagation keeps the two apart. */}
                    <span
                      role="button"
                      tabIndex={0}
                      title="Delete this entire proof/order from ApprovePro (cannot be undone)"
                      onClick={(e) => { e.stopPropagation(); handleDeleteProof(r.id); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); handleDeleteProof(r.id); } }}
                      className="absolute bottom-1.5 right-1.5 z-10 inline-flex items-center justify-center w-6 h-6 rounded-md text-gray-300 hover:text-red-600 hover:bg-red-50 cursor-pointer transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </span>
                    <div className="flex gap-3">
                      <div className="shrink-0 flex flex-col items-center gap-0.5">
                        <div className="w-16 h-12 rounded-md overflow-hidden bg-gray-100 flex items-center justify-center">
                          {thumbMap[r.id] ? (
                            <img src={thumbMap[r.id]} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <ImageIcon className="w-5 h-5 text-gray-300" />
                          )}
                        </div>
                        {/* Design product type + fee under the thumbnail */}
                        {designLabel && (
                          <span className="text-[8px] font-bold uppercase tracking-tight text-gray-500 text-center leading-tight max-w-[64px]">
                            {designLabel}
                          </span>
                        )}
                        {orderNum != null && orderTotals[String(orderNum)] != null && (
                          <span className="text-[12px] font-extrabold text-emerald-700 leading-none">
                            ${Math.round(orderTotals[String(orderNum)]).toLocaleString()}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm truncate flex items-baseline gap-1.5 min-w-0">
                            {orderNum ? (
                              <span className="font-mono font-extrabold text-[#3b82f6] shrink-0">#{orderNum}</span>
                            ) : null}
                            <span className={cn("truncate", orderNum ? "text-[12px] font-medium text-gray-600" : "font-semibold text-gray-900")}>
                              {r.design_name || "Untitled"}
                            </span>
                          </p>
                          <Badge variant="outline" className={cn("text-[9px] h-4 px-1 shrink-0", cfg.color)}>
                            <Icon className="w-2.5 h-2.5 mr-0.5" />
                            {cfg.label}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-gray-900 truncate">
                          {r.customer_name || r.customer_email}
                        </p>
                        {/* Colored status tag (highlights status) + Live-Stat tag + GO */}
                        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                          <span
                            className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold text-white shadow-sm", agent.urgent && "animate-pulse")}
                            style={{ background: agent.dot }}
                          >
                            {agent.label}
                          </span>
                          {Array.isArray(r.metadata?.customer_uploads) && r.metadata.customer_uploads.length > 0 && (
                            <span
                              title="Customer uploaded their own design — recreate it faithfully (RecreatePro)"
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white shadow-sm"
                              style={{ background: "linear-gradient(90deg,#7c3aed,#ec4899)" }}
                            >
                              ♻ Recreate
                            </span>
                          )}
                          {(r.ai_revisions_used ?? 0) > 0 && (
                            <span
                              title={`${r.ai_revisions_used} A.C.E revision${r.ai_revisions_used === 1 ? "" : "s"} so far`}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-100 text-violet-700"
                            >
                              ↻ {r.ai_revisions_used}
                            </span>
                          )}
                          {analyticsDrill && (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white shadow-sm"
                              style={{ background: "linear-gradient(90deg,#3b82f6,#ec4899)" }}
                            >
                              ★ {analyticsDrill.label}
                            </span>
                          )}
                          {!["approved", "declined", "revoked", "expired"].includes(r.status) && (
                            <span
                              role="button"
                              tabIndex={0}
                              title="Run the A.C.E agent — create the design in DesignPro, or email the customer for missing info"
                              onClick={(e) => { e.stopPropagation(); handleAgentGo(r.id); }}
                              className="ml-auto inline-flex items-center gap-0.5 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold text-white shadow-sm cursor-pointer hover:brightness-110 transition"
                              style={{ background: "linear-gradient(90deg,#0066cc,#00a8e8)" }}
                            >
                              {goingId === r.id ? "…" : "GO ›"}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] leading-tight mt-0.5 truncate" style={{ color: agent.text }}>
                          → {agent.recommend}
                        </p>
                        {/* Last customer request — so the latest message / revision
                            ask is visible right on the card, no click-in needed. */}
                        {r.change_request && (
                          <p className="text-[10px] leading-tight mt-0.5 truncate text-blue-700" title={r.change_request}>
                            💬 “{r.change_request}”
                          </p>
                        )}
                        <div className="flex items-center justify-between gap-2 mt-1">
                          <p className="text-[10px] text-gray-900/80 flex items-center gap-1 flex-wrap min-w-0">
                            <span className={cn(
                              "font-semibold text-[8px] uppercase tracking-wider px-1 rounded shrink-0",
                              isWpwOrigin
                                ? "bg-purple-100 text-purple-700"
                                : "bg-blue-100 text-blue-700",
                            )}>
                              {isWpwOrigin ? "WPW" : "RestylePro"}
                            </span>
                            {rowOrderDate(r) && (
                              <span className="font-semibold text-gray-900 shrink-0">
                                · {new Date(rowOrderDate(r)!).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                              </span>
                            )}
                            {rowOrderTotal(r) != null && (
                              <span className="font-bold text-emerald-700 shrink-0">
                                · ${rowOrderTotal(r)!.toFixed(2)}
                              </span>
                            )}
                          </p>
                          {/* Assignee = the circle with initials. No circle
                              means unassigned (A.C.E owns it) — no label. */}
                          {assignee && (
                            <div className="flex items-center gap-1 shrink-0">
                              <AssigneeAvatar member={assignee} size="xs" className="shrink-0" />
                              <span className="text-[10px] font-medium text-gray-700 max-w-[72px] truncate">
                                {assignee.name || assignee.email?.split("@")[0]}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* RIGHT — detail */}
          <section ref={detailRef} className="scroll-mt-4 min-w-0">
            {!selected ? (
              <Card className="overflow-hidden bg-white border-gray-200">
                <div className="bg-gradient-to-br from-[#3b82f6]/5 to-[#ec4899]/5 border-b border-gray-200 px-6 py-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#3b82f6] to-[#ec4899] flex items-center justify-center shadow-sm">
                      <ClipboardSignature className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-gray-800 font-semibold">Start here</div>
                      <h2 className="text-lg font-bold text-gray-900">How ApprovePro works</h2>
                    </div>
                  </div>
                </div>
                <div className="p-6">
                  <ol className="space-y-4">
                    <li className="flex gap-4">
                      <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold shrink-0">1</div>
                      <div className="flex-1">
                        <div className="font-semibold text-gray-900 text-sm">Pick a job from the rails on the left</div>
                        <p className="text-xs text-gray-600 mt-0.5">
                          <span className="font-semibold text-gray-800">QC Artboard jobs</span>, <span className="font-semibold text-gray-800">Recent Renders</span> (ColorPro / DesignPro / FadeWraps), and <span className="font-semibold text-gray-800">WPW orders</span> all show up there. Click any one and it becomes a proof — pre-filled with the vehicle, render, and customer info. Or click <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white text-[10px] font-bold"><Plus className="w-2.5 h-2.5" />New Proof</span> in the toolbar to start from scratch.
                        </p>
                      </div>
                    </li>
                    <li className="flex gap-4">
                      <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-bold shrink-0">2</div>
                      <div className="flex-1">
                        <div className="font-semibold text-gray-900 text-sm">Send the customer a branded approval link</div>
                        <p className="text-xs text-gray-600 mt-0.5">
                          One click sends a beautifully branded page (with your shop logo + name) where the customer can <span className="font-semibold text-emerald-700">Approve</span>, <span className="font-semibold text-amber-700">Request revisions</span>, or <span className="font-semibold text-rose-700">Decline</span>. They can also fire AI revisions themselves if your tier includes them.
                        </p>
                      </div>
                    </li>
                    <li className="flex gap-4">
                      <div className="w-8 h-8 rounded-full bg-pink-100 text-pink-700 flex items-center justify-center font-bold shrink-0">3</div>
                      <div className="flex-1">
                        <div className="font-semibold text-gray-900 text-sm">Track responses live and push new versions</div>
                        <p className="text-xs text-gray-600 mt-0.5">
                          The home dashboard pulses pink the moment a customer responds. Right here on this page you'll see every email sent, every version uploaded, and a full audit trail — so the team always knows where each job stands.
                        </p>
                      </div>
                    </li>
                  </ol>
                  <div className="mt-6 flex items-center gap-2 flex-wrap">
                    <Button
                      onClick={() => setShowNewProof(true)}
                      className="gap-1 bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white hover:brightness-110 border-0"
                    >
                      <Plus className="w-4 h-4" />
                      Start a new proof
                    </Button>
                    <span className="text-xs text-gray-800">
                      …or click any job in the rails on the left {(rows?.length ?? 0) > 0 ? "or further down" : ""}.
                    </span>
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="overflow-hidden bg-white border-gray-200">
                {/* ── A.C.E hero (Trish's ApprovePro mockup): chat (left) ·
                    mascot (center) · talk/type (right), on the gradient. ── */}
                {!isTerminal(selected.status) && (
                  <div style={{ background: "linear-gradient(135deg,#7c3aed 0%,#6366f1 45%,#ec4899 100%)" }}>
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(180px,auto)_minmax(0,1fr)] gap-4 items-stretch p-4">
                      {/* LEFT — recent customer chat */}
                      <div className="order-2 lg:order-1 rounded-2xl bg-white/95 shadow-sm flex flex-col h-[230px]">
                        <div className="px-3.5 py-2 border-b border-gray-100 text-[11px] font-bold text-violet-600 flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5" /> Chat</div>
                        <div className="flex-1 overflow-y-auto p-3 space-y-2">
                          {(() => {
                            const msgs = (replyEvents || [])
                              .map((e) => ({ who: e.actor_role === "customer" ? "customer" : "team", body: String(e.payload?.message || e.payload?.notes || e.payload?.prompt || "").trim() }))
                              .filter((m) => m.body);
                            if (msgs.length === 0) return <p className="text-xs text-gray-400 italic">No messages yet.</p>;
                            return msgs.slice(-8).map((m, i) => (
                              <div key={i} className={`flex ${m.who === "team" ? "justify-end" : "justify-start"}`}>
                                <div className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-[12px] ${m.who === "team" ? "text-white" : "bg-gray-100 text-gray-800"}`} style={m.who === "team" ? { background: "linear-gradient(90deg,#3b82f6,#ec4899)" } : undefined}>{m.body}</div>
                              </div>
                            ));
                          })()}
                        </div>
                      </div>
                      {/* CENTER — ACE mascot + greeting */}
                      <div className="order-1 lg:order-2 flex flex-col items-center justify-center text-center px-1">
                        <img src="/characters/ace-engine.png" onError={(e) => ((e.currentTarget as HTMLImageElement).src = "/characters/ace-hero.png")} alt="A.C.E" className="w-24 h-24 sm:w-28 sm:h-28 object-contain drop-shadow-2xl" />
                        <h2 className="text-lg sm:text-xl font-extrabold text-white leading-tight mt-1">Hi! I'm A.C.E 👋</h2>
                        <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wide text-white/95 leading-tight">AI Creative Engine</p>
                        <p className="text-[11px] sm:text-[12px] text-white/85 mt-1 max-w-[220px]">Talk or type — I design the wrap live.</p>
                      </div>
                      {/* RIGHT — talk or type to A.C.E */}
                      <div className="order-3 rounded-2xl bg-white/95 shadow-sm flex flex-col h-[230px]">
                        <div className="px-3.5 py-2 border-b border-gray-100 text-[11px] font-bold text-pink-600 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5" /> Talk or type to A.C.E</div>
                        <div className="flex-1 overflow-y-auto p-3 text-[12px] text-gray-500">
                          {aceMicError ? <span className="text-red-500">{aceMicError}</span>
                            : aceTranscribing ? <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> transcribing…</span>
                            : aceRecording ? <span className="flex items-center gap-1.5 text-red-500"><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> listening… tap stop</span>
                            : <span>Describe the change and press GO — A.C.E recreates or designs it as a new version.</span>}
                        </div>
                        <div className="border-t border-gray-100 p-2.5 flex items-end gap-2">
                          <button type="button" onClick={toggleAceMic} disabled={aceTranscribing} title={aceRecording ? "Stop" : "Talk to A.C.E"}
                            className={`h-10 w-10 shrink-0 rounded-lg flex items-center justify-center border transition-colors ${aceRecording ? "bg-red-500 border-red-500 text-white animate-pulse" : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
                            {aceRecording ? <Square className="w-4 h-4" /> : <Mic className="w-5 h-5" />}
                          </button>
                          <Textarea value={aceBrief} onChange={(e) => setAceBrief(e.target.value)} rows={1} placeholder={aceRecording ? "Listening…" : "Message A.C.E…"} className="resize-none min-h-[40px] text-sm bg-white text-gray-900 placeholder:text-gray-400" />
                          <button type="button" onClick={handleSaveContextAndGo} disabled={busyAction === "agent-go" || goingId === selected.id}
                            className="h-10 px-3 shrink-0 rounded-lg flex items-center justify-center text-white text-sm font-bold disabled:opacity-40" style={{ background: "linear-gradient(135deg,#3b82f6,#8b5cf6,#ec4899)" }}>
                            {(busyAction === "agent-go" || goingId === selected.id) ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Rocket className="w-4 h-4 mr-1" /> GO</>}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* A.C.E banner removed (Trish) — the three customer-data cards
                    below carry the order context; actions live in the Manual
                    dropdown + Design & Send tab. */}

                {/* ── CUSTOMER DATA — two cards: the written instruction/prompt,
                    and the customer-provided assets/examples. Blue gradient
                    headers, white bodies with black text. Thumbnails ENLARGE on
                    hover so the team inspects references without leaving the
                    page. ── */}
                {(() => {
                  const md = (selected.metadata || {}) as any;
                  const orderNo = md.wpw_order_number || md.wpw_woo_order_id || selected.id.slice(0, 8);
                  const vehicle = [selected.vehicle_year, selected.vehicle_make, selected.vehicle_model].filter(Boolean).join(" ");
                  const placed = rowOrderDate(selected);
                  const placedStr = placed ? new Date(placed).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;
                  const brief = [md.order_customer_note, md.line_item_brief, md.customer_note]
                    .filter((s: any) => typeof s === "string" && s.trim())
                    .filter((s: any, i: number, a: any[]) => a.indexOf(s) === i)
                    .join("\n\n");
                  const uploads: string[] = Array.isArray(md.customer_uploads) ? md.customer_uploads : [];
                  const blueHdr = "linear-gradient(135deg,#0066cc,#00a8e8,#0080dd)";
                  return (
                    <div className="px-3 pt-2 bg-white">
                      {/* Compact: each card is a blue label header + tight body,
                          capped at the same short height so the row never grows
                          the page. Inline "LABEL:" headers, no emoji bulk. */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-start">
                        {/* Card 1 — Order Info (big order number) */}
                        <div className="rounded-md overflow-hidden border border-blue-200">
                          <div className="px-2.5 py-1 text-white text-[10px] font-bold uppercase tracking-wider" style={{ background: blueHdr }}>
                            Order Info:
                          </div>
                          <div className="px-2.5 py-1.5 bg-white max-h-32 overflow-y-auto">
                            <div className="text-[20px] font-extrabold text-gray-900 leading-none tracking-tight">#{orderNo}</div>
                            <div className="mt-1 text-[11px] text-gray-700 leading-tight">
                              {selected.customer_name && <span className="font-semibold text-gray-900">{selected.customer_name}</span>}
                              {vehicle && <span> · {vehicle}</span>}
                              {placedStr && <span> · {placedStr}</span>}
                              {selected.customer_email && <span className="block truncate text-gray-500">{selected.customer_email}</span>}
                            </div>
                            {/* Open this order in Studio Board (PanelProStudio) to
                                extract/refine each side's print panel + approve. */}
                            <a
                              href={`/admin/studio-board?order=${encodeURIComponent(String(md.wpw_order_number || md.wpw_woo_order_id || selected.id))}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-gradient-to-r from-[#3b82f6] to-[#ec4899] px-2 py-1 text-[11px] font-semibold text-white hover:brightness-110"
                            >
                              Open in Studio Board →
                            </a>
                          </div>
                        </div>
                        {/* Card 2 — Instruction / Prompt — now a CAROUSEL that
                            pages through the customer's most recent edits &
                            messages (newest first) AND the original written
                            instruction, each stamped with date + time. Opens
                            on the latest activity so the designer sees the most
                            recent customer feedback without leaving the card. */}
                        <div className="rounded-md overflow-hidden border border-blue-200">
                          <InstructionCarousel
                            key={selected.id}
                            instruction={brief}
                            instructionDate={placed}
                            events={replyEvents}
                            customerName={selected.customer_name}
                            headerBg={blueHdr}
                          />
                        </div>
                        {/* Card 3 — Customer Provided Assets. The "Check design
                            email" button runs the design-mailbox API (Outlook /
                            Azure Graph) for THIS order, so files the customer
                            emailed instead of uploading land here before GO. */}
                        <div className="rounded-md overflow-hidden border border-blue-200">
                          <div className="px-2.5 py-1 text-white text-[10px] font-bold uppercase tracking-wider flex items-center justify-between" style={{ background: blueHdr }}>
                            <span>Customer Provided Assets</span>
                            {uploads.length > 0 && <span className="text-[10px] font-semibold text-white/85">{uploads.length}</span>}
                          </div>
                          <div className="px-2.5 py-1.5 bg-white max-h-32 overflow-y-auto">
                            {uploads.length > 0
                              ? <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5">
                                  {uploads.map((url, i) => (
                                    <HoverZoomThumb
                                      key={i}
                                      url={url}
                                      alt={`Customer asset ${i + 1}`}
                                      className="block rounded border border-blue-200 bg-white overflow-hidden aspect-square hover:border-blue-400 transition-colors"
                                      imgClassName="w-full h-full object-cover"
                                    />
                                  ))}
                                </div>
                              : <p className="text-[11px] text-gray-400 italic">No examples uploaded — hover any future upload to enlarge.</p>}
                            <div className="mt-1.5 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={handleCheckDesignInbox}
                                disabled={busyAction === "inbox"}
                                title="Search design@weprintwraps.com for this customer's email and pull its files onto the order"
                                className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-white px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                              >
                                <Mail className="h-3 w-3" />
                                {busyAction === "inbox" ? "Checking inbox…" : "Check design email"}
                              </button>
                              {md.brief_source === "email" && (
                                <span className="text-[10px] text-gray-500">
                                  Last pulled from email
                                  {md.brief_found_at ? ` · ${new Date(md.brief_found_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
                                </span>
                              )}
                            </div>
                            {md.design_pending_promised_files && uploads.length === 0 && (
                              <p className="mt-1 text-[10px] text-amber-700">
                                Customer said files were coming — none received yet. This design was drafted without them.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Manual actions — multi-choice override of the A.C.E agent */}
                <div className="px-3 sm:px-4 py-2 bg-white border-b border-gray-200 flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Manual</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline" className="h-8 gap-1 border-gray-200 text-gray-700">
                        Choose an action <ChevronDownIcon className="w-3.5 h-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-72">
                      <DropdownMenuLabel>Send / trigger manually</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => setSendProofOpen(true)}>
                        <Send className="w-4 h-4 mr-2 text-green-600" /> Send proof to customer
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setPendingAction("request_info")}>
                        <Sparkles className="w-4 h-4 mr-2 text-pink-600" /> Send missing-art instructions + portal link
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setPendingAction("go")}>
                        <Sparkles className="w-4 h-4 mr-2 text-blue-600" /> Create the design in DesignPro (GO)
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setPendingAction("revision")}>
                        <RotateCw className="w-4 h-4 mr-2 text-fuchsia-600" /> Trigger revision — "how can we get it right?"
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Follow-ups</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => setPendingAction("followup")}>
                        <Send className="w-4 h-4 mr-2 text-amber-600" /> Send best-fit follow-up (auto)
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setPendingAction("convert_3d")}>
                        <Sparkles className="w-4 h-4 mr-2 text-indigo-600" /> "See your 2D proof in 3D" — $20 / RecreatePro X
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {/* A.C.E — the AI Create Engine. Compact gradient button with a
                      moving glow (replaces the removed banner). Click = GO. */}
                  <button
                    type="button"
                    onClick={() => handleAgentGo()}
                    disabled={busyAction === "agent-go" || goingId === selected.id}
                    title="A.C.E — AI Create Engine. Generate / advance this design (GO)."
                    className="ace-glow inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-white text-[11px] font-bold uppercase tracking-wide shadow-sm disabled:opacity-60 disabled:animate-none"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    A.C.E · AI Create Engine
                  </button>
                  {/* MESSAGE COMPOSER — always-visible, impossible-to-miss trigger.
                      Opens the composer: choose which proofs to send + type a
                      message + AI improve. */}
                  <button
                    type="button"
                    onClick={() => setSendProofOpen(true)}
                    title="Compose a message + choose which proofs/designs to send to the customer's portal (with AI improve)."
                    className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-white text-[11px] font-bold uppercase tracking-wide shadow-sm hover:brightness-110"
                    style={{ background: "linear-gradient(90deg,#3b82f6,#ec4899)" }}
                  >
                    <Mail className="w-3.5 h-3.5" />
                    Message Customer
                  </button>
                  {/* Designer assignment lives right here by GO — claim /
                      reassign / unassign at the point of action. */}
                  <div className="ml-auto">
                    <AssignProofControl
                      proofId={selected.id}
                      assignedTo={selected.assigned_to}
                      onChange={(newAssignee) => {
                        setRows((prev) => (prev || []).map((p) =>
                          p.id === selected.id
                            ? { ...p, assigned_to: newAssignee, assigned_at: newAssignee ? new Date().toISOString() : null }
                            : p,
                        ));
                      }}
                    />
                  </div>
                </div>
                {/* Hero — design preview if one exists, otherwise a small
                    placeholder. Upload form lives below the order details
                    so the brief / customer uploads / vehicle info show
                    above the fold. */}
                {/* Hero — only when a REAL design exists. No empty gray
                    placeholder box; the larger A.C.E bar carries the context. */}
                {displayHero && (() => {
                  // News-reel carousel (matches RevisionStudio) — SAME size box,
                  // arrows skim through every angle in place via heroOverrideUrl.
                  const VO = ["hero", "side", "driver-side", "passenger-side", "front", "rear", "roof", "hood_detail", "hood", "close-up"];
                  const VL2: Record<string, string> = { hero: "Driver Side", side: "Driver Side", "driver-side": "Driver Side", "passenger-side": "Passenger Side", front: "Front", rear: "Rear", roof: "Roof", hood_detail: "Hood", hood: "Hood", "close-up": "Close-Up" };
                  const SKIP2 = new Set(["production_proof", "proof_2d", "master_artboard", "artboard", "flat_artboard"]);
                  const raw2 = (Object.entries(activeVersion?.render_urls || {}).filter(([k, u]) => !!u && !SKIP2.has(k) && !String(u).includes("weprintwraps.com"))) as [string, string][];
                  raw2.sort((a, b) => { const ia = VO.indexOf(a[0]); const ib = VO.indexOf(b[0]); return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib); });
                  const seen2 = new Set<string>();
                  const hv = raw2.filter(([, u]) => { if (seen2.has(u)) return false; seen2.add(u); return true; }).map(([k, u]) => ({ label: VL2[k] || k.replace(/[_-]+/g, " "), url: u }));
                  const ci = Math.max(0, hv.findIndex((v) => v.url === displayHero));
                  const cl = hv[ci]?.label;
                  const goH = (d: number) => { if (hv.length) setHeroOverrideUrl(hv[(hv.length + ci + d) % hv.length].url); };
                  return (
                  <div className="relative bg-gray-50">
                    <img
                      src={displayHero}
                      alt={selected.design_name || "Proof"}
                      className="w-full max-h-[480px] object-contain bg-gray-100"
                    />
                    {/* Status strip */}
                    <div className="absolute top-3 left-3 flex items-center gap-2">
                      <Badge variant="outline" className={cn("text-[10px] h-5 px-1.5 gap-1 bg-white/90", STATUS[selected.status].color)}>
                        {selected.status}
                      </Badge>
                      {selected.mode === "sign_only" && (
                        <Badge variant="outline" className="text-[10px] h-5 px-1.5 bg-white/90">
                          Sign-only
                        </Badge>
                      )}
                      {selected.has_line_items && (
                        <Badge variant="outline" className="text-[10px] h-5 px-1.5 bg-white/90 text-blue-700 border-blue-200">
                          Multi-item ({lineItemRows.length})
                        </Badge>
                      )}
                      {activeVersion && (
                        <Badge variant="outline" className="text-[10px] h-5 px-1.5 bg-white/90">
                          v{activeVersion.version_number}
                        </Badge>
                      )}
                    </div>
                    {/* Arrows + count + dots — only when there are multiple views */}
                    {hv.length > 1 && (
                      <>
                        <button type="button" onClick={() => goH(-1)} aria-label="Previous view" title="Previous view"
                          className="absolute left-2 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white transition-all">
                          <ChevronLeft className="w-5 h-5" />
                        </button>
                        <button type="button" onClick={() => goH(1)} aria-label="Next view" title="Next view"
                          className="absolute right-2 top-1/2 -translate-y-1/2 z-20 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white transition-all">
                          <ChevronRight className="w-5 h-5" />
                        </button>
                        <span className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-black/60 text-white rounded-full px-2.5 py-0.5 text-[11px] font-semibold">
                          {cl ? `${cl} · ` : ""}{ci + 1}/{hv.length}
                        </span>
                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1">
                          {hv.map((_, i) => (
                            <button key={i} type="button" onClick={() => setHeroOverrideUrl(hv[i].url)} aria-label={`View ${i + 1}`}
                              className={cn("w-2.5 h-2.5 rounded-full transition-all", i === ci ? "bg-white scale-125" : "bg-white/40")} />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  );
                })()}

                {/* CUT-CONTOUR FILE-OUTPUT (SKU DSFO) — the customer PROVIDED the
                    design, so A.C.E never runs. Replace the generated artboard /
                    creative deliverables with their files + the deterministic
                    print-ready cut-contour builder. */}
                {(((selected.metadata as any)?.design_route === "cut_contour") || isCutContourFileOutputOrder(selected.metadata)) && (
                  <>
                    <CutContourPanel proofId={selected.id} metadata={selected.metadata as any} />
                    {/* Cut Graphics Proof — dimensioned production sheet (W×H +
                        letter height + total sq ft), auto-generated for cut-contour
                        jobs and persisted to the order. */}
                    <CutGraphicsProofCard
                      proofId={selected.id}
                      metadata={selected.metadata as any}
                      sideRenderUrl={(activeVersion?.render_urls as any)?.side || heroUrl(activeVersion)}
                      vehicleYear={selected.vehicle_year}
                      vehicleMake={selected.vehicle_make}
                      vehicleModel={selected.vehicle_model}
                      designName={(selected.metadata as any)?.design_name || selected.design_name}
                      autoGenerate
                      onSaved={refreshSelected}
                    />
                  </>
                )}

                {/* MASTER ARTBOARD — the single-source flat artboard (first thing
                    generated; feeds RecreatePro's 3D + the production panels).
                    Surfaced on the admin order so the team can see/open it.
                    Hidden for cut-contour orders (customer provided the art). */}
                {(() => {
                  if (((selected.metadata as any)?.design_route === "cut_contour") || isCutContourFileOutputOrder(selected.metadata)) return null;
                  const artboard = (selected.metadata as any)?.master_artboard_url
                    || (activeVersion?.render_urls as any)?.master_artboard
                    || null;
                  if (!artboard) return null;
                  return (
                    <div className="mx-3 mt-3 rounded-lg border border-fuchsia-200 bg-fuchsia-50/40 p-2">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-fuchsia-900">
                          Master Artboard — single source
                        </p>
                        <div className="flex items-center gap-2.5">
                          <a href={artboard} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-fuchsia-700 hover:underline">
                            Open ↗
                          </a>
                          <button
                            type="button"
                            onClick={handleDeleteArtboard}
                            title="Delete the master artboard (the 3D views stay)"
                            className="text-[11px] font-bold text-red-600 hover:text-red-700"
                          >
                            ✕ Delete
                          </button>
                        </div>
                      </div>
                      <a href={artboard} target="_blank" rel="noreferrer" className="block">
                        <img src={artboard} alt="Master artboard" className="w-full max-h-56 object-contain rounded bg-white border border-fuchsia-100" />
                      </a>
                    </div>
                  );
                })()}

                {/* Cut Graphics Proof — also available for designed (non-cut-contour)
                    orders so a GraphicsPro cut-graphics job gets its dimensioned
                    production sheet. Manual generate (no auto) so printed-wrap orders
                    aren't spammed; shows automatically once a proof is saved. */}
                {!(((selected.metadata as any)?.design_route === "cut_contour") || isCutContourFileOutputOrder(selected.metadata)) && (
                  <CutGraphicsProofCard
                    proofId={selected.id}
                    metadata={selected.metadata as any}
                    sideRenderUrl={(activeVersion?.render_urls as any)?.side || heroUrl(activeVersion)}
                    vehicleYear={selected.vehicle_year}
                    vehicleMake={selected.vehicle_make}
                    vehicleModel={selected.vehicle_model}
                    designName={(selected.metadata as any)?.design_name || selected.design_name}
                    sourceVisualizationId={(selected as any).source_visualization_id}
                    onSaved={refreshSelected}
                  />
                )}

                {/* DESIGN ASSETS 💰 — the sellable, single-source deliverables
                    for this order: the WPW-branded 2D Production Proof, the clean
                    background, and the transparent element PNGs the lift cut from
                    the master artboard. This is the latest version used when the
                    customer orders the Production Pack. */}
                {(() => {
                  if (((selected.metadata as any)?.design_route === "cut_contour") || isCutContourFileOutputOrder(selected.metadata)) return null;
                  const ru = (activeVersion?.render_urls as any) || {};
                  const proof2d = ru.production_proof || ru.proof_2d || null;
                  const bg = designAssets?.background_url || null;
                  const pngs: string[] = (designAssets?.overlay_pngs || [])
                    .map((p: any) => (typeof p === "string" ? p : p?.url || p?.png_url || p?.storageUrl))
                    .filter((u: any) => typeof u === "string" && u);
                  const hasAnyAsset = !!proof2d || !!bg || pngs.length > 0;
                  const artboardUrl = (selected.metadata as any)?.master_artboard_url || ru.master_artboard || null;
                  return (
                    <div className="mx-3 mt-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-2.5 space-y-2.5">
                      {/* Live generation progress — mirrors what the customer
                          sees in the ACE genie, so the shop can watch a revision
                          (or regenerate) come together right in the workbench. */}
                      {(busyAction === "autogen" || (selected.metadata as any)?.autogen_status === "running") && (
                        <RevisionProgress
                          active
                          variant="light"
                          label="A.C.E is generating this version"
                          estimateSeconds={120}
                          messages={[
                            "Reading your request…",
                            "Designing the artboard…",
                            "Rendering all 7 views (sides, front, rear, hood, roof)…",
                            "Keeping the rest of the wrap exactly as it was…",
                            "Building the 2D production proof…",
                            "Quality-checking the set…",
                          ]}
                        />
                      )}
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm">💰</span>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-900">Design Assets — sellable · Production Pack source</p>
                        <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
                          <button
                            type="button"
                            onClick={() => setSendProofOpen(true)}
                            title="Compose the email, pick which proofs (2D / 3D) the customer sees, optionally let A.C.E refine your message, then send it to their portal where they can approve or revise."
                            className="inline-flex items-center gap-1 rounded-md text-white text-[10px] font-bold px-2.5 py-1 shadow-sm hover:brightness-110"
                            style={{ background: "linear-gradient(90deg,#3b82f6,#ec4899)" }}
                          >
                            ✉️ Send Proof
                          </button>
                          <button
                            type="button"
                            onClick={() => setShow2DProofSheet(true)}
                            title="View the dimensioned 2D Production Proof SHEET (logo + dimension arrows). Re-composed from the views, so it never shows a single side."
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-white text-emerald-700 text-[10px] font-bold px-2 py-1 hover:bg-emerald-50"
                          >
                            📄 2D Proof
                          </button>
                          <button
                            type="button"
                            onClick={() => setShow3DProofSheet(true)}
                            title="View the formatted multi-angle 3D Design Approval Proof (the customer-facing gallery)."
                            className="inline-flex items-center gap-1 rounded-md border border-violet-300 bg-white text-violet-700 text-[10px] font-bold px-2 py-1 hover:bg-violet-50"
                          >
                            📄 3D Proof
                          </button>
                          {artboardUrl && (
                            <a
                              href={artboardUrl}
                              target="_blank"
                              rel="noreferrer"
                              title="View the flat master artboard (the single-source design the 3D + panels flow from)."
                              className="inline-flex items-center gap-1 rounded-md border border-fuchsia-300 bg-white text-fuchsia-700 text-[10px] font-bold px-2 py-1 hover:bg-fuchsia-50"
                            >
                              🎨 Artboard
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={handleGenerate3DProof}
                            disabled={busyAction === "autogen"}
                            title="Regenerate the 3D proof — artboard FIRST, then the multi-angle photoreal set, then the 2D proof. Clears the stuck flag so it never no-ops."
                            className="inline-flex items-center gap-1 rounded-md bg-violet-600 text-white text-[10px] font-bold px-2 py-1 hover:bg-violet-700 disabled:opacity-50"
                          >
                            {busyAction === "autogen" ? "Generating…" : "↻ Regenerate"}
                          </button>
                          <button
                            type="button"
                            onClick={handleGenerate2DProof}
                            disabled={proof2dBusy}
                            title="Compose the WePrintWraps 2D production proof from the current views — deterministic (no Gemini drift). This is the first proof you send."
                            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 text-white text-[10px] font-bold px-2 py-1 hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {proof2dBusy ? "Composing…" : (proof2d ? "↻ Refresh 2D Proof" : "Generate WPW 2D Proof")}
                          </button>
                          {proof2d && (
                            <button
                              type="button"
                              onClick={handleDelete2DProof}
                              title="Delete the current 2D production proof (the 3D views + artboard stay). Use this to clear a wrong/mislabeled proof, then regenerate."
                              className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-white text-red-600 text-[10px] font-bold px-2 py-1 hover:bg-red-50"
                            >
                              ✕ Delete 2D
                            </button>
                          )}
                          {/* ALWAYS-AVAILABLE manual 2D-proof setters — work even when
                              there's no proof yet (after a delete), so you can drop in
                              the correct one without re-composing from wrong views. */}
                          {activeVersion?.id && (
                            <label
                              title="Upload the correct 2D production proof image — sets it on this version."
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-white text-emerald-700 text-[10px] font-bold px-2 py-1 hover:bg-emerald-50 cursor-pointer"
                            >
                              {uploadViewKey === "production_proof" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                              Upload 2D
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                disabled={uploadViewKey === "production_proof"}
                                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadViewImage("production_proof", f); e.currentTarget.value = ""; }}
                              />
                            </label>
                          )}
                          {activeVersion?.id && (
                            <button
                              type="button"
                              title="Paste the correct 2D proof image URL (e.g. from Revision Studio) — sets it on this version."
                              onClick={async () => {
                                if (!activeVersion?.id) return;
                                const url = (window.prompt("Paste the correct 2D proof image URL:") || "").trim();
                                if (!url) return;
                                const ru: Record<string, string> = { ...(activeVersion.render_urls || {}), production_proof: url };
                                const { error } = await supabase.from("proof_versions" as any).update({ render_urls: ru }).eq("id", activeVersion.id);
                                if (error) { toast({ title: "Couldn't set 2D proof", description: error.message, variant: "destructive" }); return; }
                                setActiveVersion({ ...activeVersion, render_urls: ru } as ActiveVersion);
                                setAllVersions((vs) => vs.map((v) => (v.id === activeVersion.id ? { ...v, render_urls: ru } : v)));
                                toast({ title: "2D proof set", description: "Imported the 2D proof onto this version." });
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-white text-blue-700 text-[10px] font-bold px-2 py-1 hover:bg-blue-50"
                            >
                              ⇪ Import 2D URL
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={handleGenerateArtboard}
                            disabled={artboardBusy}
                            title="Generate the flat master ARTBOARD — flattens the approved design from the 2D production proof into print-ready flat panels. Saved to Design Assets."
                            className="inline-flex items-center gap-1 rounded-md text-white text-[10px] font-bold px-2 py-1 hover:brightness-110 disabled:opacity-50"
                            style={{ background: "linear-gradient(90deg,#c026d3,#ec4899)" }}
                          >
                            {artboardBusy ? "Generating…" : "🎨 Generate Artboard"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!selected) return;
                              // Wire ApprovePro → Design Assets exactly like Revision Studio:
                              // stash this job's views + 2D production proof + vehicle info so
                              // the build runs from them (the proof_approvals id isn't in
                              // designiq/cv, so the page builds entirely from the stashed ctx).
                              const ru = (activeVersion?.render_urls || selected.render_urls || {}) as Record<string, string>;
                              const viewsMap = { ...ru };
                              delete viewsMap.production_proof; delete viewsMap.proof_2d;
                              delete viewsMap.master_artboard; delete viewsMap.artboard;
                              const flatProof = ru.production_proof || ru.proof_2d || null;
                              try {
                                sessionStorage.setItem(`buildctx:${selected.id}`, JSON.stringify({
                                  render_urls: viewsMap,
                                  flat_proof_url: flatProof,
                                  make: selected.vehicle_make || null,
                                  model: selected.vehicle_model || null,
                                  year: selected.vehicle_year || null,
                                }));
                              } catch { /* storage disabled — params below still help */ }
                              const p = new URLSearchParams({ build: "1" });
                              if (selected.vehicle_make) p.set("make", String(selected.vehicle_make));
                              if (selected.vehicle_model) p.set("model", String(selected.vehicle_model));
                              if (selected.vehicle_year) p.set("year", String(selected.vehicle_year));
                              navigate(`/design-assets/${selected.id}?${p.toString()}`);
                            }}
                            title="Build the per-side print panels (background + transparent overlay) on the Design Assets page — same pipeline as DesignPro / Revision Studio."
                            className="inline-flex items-center gap-1 rounded-md bg-emerald-700 text-white text-[10px] font-bold px-2 py-1 hover:bg-emerald-800"
                          >
                            🧩 Build Files
                          </button>
                          {/* Push this order's design into Panel Studio (admin) to
                              create the print panel files — prefills the 2D proof as
                              the VisionBoard reference + vehicle + project name. */}
                          <button
                            type="button"
                            onClick={() => {
                              const proofUrl = proof2d || (activeVersion?.render_urls as any)?.production_proof || (activeVersion?.render_urls as any)?.proof_2d || "";
                              const vehicle = [selected?.vehicle_year, selected?.vehicle_make, selected?.vehicle_model].filter(Boolean).join(" ");
                              const project = String((selected?.metadata as any)?.wpw_order_number || (selected as any)?.design_name || selected?.id || "");
                              const p = new URLSearchParams();
                              if (proofUrl) p.set("proof_url", proofUrl);
                              if (vehicle) p.set("vehicle", vehicle);
                              if (project) p.set("project", project);
                              window.open(`/admin/wrap-panel-studio?${p.toString()}`, "_blank", "noopener");
                            }}
                            title="Open this design in Panel Studio (admin) to create the print panel files."
                            className="inline-flex items-center gap-1 rounded-md bg-cyan-600 text-white text-[10px] font-bold px-2 py-1 hover:bg-cyan-700"
                          >
                            🧱 Panel Studio
                          </button>
                        </div>
                      </div>
                      {!hasAnyAsset && (
                        <div className="rounded-md border border-dashed border-emerald-300 bg-white/60 p-3 text-[11px] text-emerald-900/80 leading-relaxed">
                          <span className="font-semibold">No assets generated yet.</span> Press <span className="font-semibold">GO / re-GO</span> — A.C.E generates the
                          {" "}<span className="font-semibold">artboard (the design from the prompt)</span>, then the WePrintWraps 2D proof, transparent element PNGs, and background panels all flow from it and appear here.
                          {artboardUrl && <> The artboard design is ready — <a href={artboardUrl} target="_blank" rel="noreferrer" className="font-semibold underline">open it ↗</a>.</>}
                        </div>
                      )}
                      {hasAnyAsset && (() => {
                        const VL: Record<string, string> = { side: "Driver Side", "passenger-side": "Passenger Side", hood_detail: "Hood", front: "Front", rear: "Rear", "close-up": "Close-Up", roof: "Roof" };
                        const order = ["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"];
                        const views = order.filter((k) => ru[k]).map((k) => ({ key: k, url: ru[k] as string, label: VL[k] || k }));
                        // 2D Proof = the dimensioned multi-view production SHEET (production_proof).
                        // 3D Proof = the multi-angle on-vehicle render SET (never a single side).
                        const tabs = [["2d", "2D Proof"], ["3d", `3D Proof (${views.length})`]] as const;
                        const tab = assetTab === "angles" ? "3d" : assetTab;
                        return (
                          <div className="rounded-md border border-emerald-100 bg-white p-2">
                            <div className="grid grid-cols-2 gap-1 mb-2">
                              {tabs.map(([k, lbl]) => (
                                <button key={k} type="button" onClick={() => setAssetTab(k)}
                                  className={cn("h-7 rounded text-[11px] font-bold transition", tab === k ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100")}>{lbl}</button>
                              ))}
                            </div>
                            {tab === "2d" && (
                              <div>
                                {proof2d
                                  ? <button type="button" onClick={() => setShow2DProofSheet(true)} className="block w-full" title="Open the formatted 2D Production Proof sheet"><img src={proof2d} alt="2D production proof" className="w-full max-h-80 object-contain rounded bg-white" /></button>
                                  : <p className="text-[11px] text-gray-500 italic text-center pt-4">No 2D proof composed yet — the dimensioned multi-view sheet is built from the 3D angles.</p>}
                                <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
                                  <button type="button" onClick={() => setShow2DProofSheet(true)} disabled={!views.length}
                                    className="text-[11px] font-semibold text-emerald-700 hover:underline disabled:opacity-40">Open 2D Production Proof sheet →</button>
                                  <button type="button" onClick={handleGenerate2DProof} disabled={proof2dBusy || !views.length}
                                    className="inline-flex items-center gap-1 rounded-md bg-emerald-600 text-white text-[11px] font-bold px-3 py-1 hover:bg-emerald-700 disabled:opacity-50">
                                    {proof2dBusy ? "Composing…" : (proof2d ? "↻ Refresh" : "Generate")}
                                  </button>
                                  {/* MANUAL UPLOAD — drop a corrected 2D proof image
                                      straight onto this version (writes render_urls.production_proof). */}
                                  {activeVersion?.id && (
                                    <label className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-white text-emerald-700 text-[11px] font-bold px-3 py-1 hover:bg-emerald-50 cursor-pointer">
                                      {uploadViewKey === "production_proof" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                                      Upload 2D proof
                                      <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        disabled={uploadViewKey === "production_proof"}
                                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadViewImage("production_proof", f); e.currentTarget.value = ""; }}
                                      />
                                    </label>
                                  )}
                                </div>
                              </div>)}
                            {tab === "3d" && (
                              <div>
                                {/* Per-view tiles over the FULL canonical set so an
                                    operator can replace OR add a missing angle: each
                                    tile = image (or empty slot) + per-view manual
                                    Upload (uploadViewImage) + per-view Delete
                                    (handleDeleteView). activeVersion required for edits. */}
                                <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                                  {order.map((k) => {
                                    const url = ru[k] as string | undefined;
                                    const label = VL[k] || k;
                                    const busy = uploadViewKey === k || viewBusyKey === k;
                                    return (
                                      <div key={k} className="relative">
                                        {url
                                          ? <HoverZoomThumb url={url} alt={label} className="block rounded border border-emerald-100 overflow-hidden aspect-video" imgClassName="w-full h-full object-cover" />
                                          : <div className="rounded border border-dashed border-gray-200 bg-gray-50 aspect-video flex items-center justify-center"><ImageIcon className="w-4 h-4 text-gray-300" /></div>}
                                        <span className="block text-[9px] text-gray-500 mt-0.5 truncate">{label}</span>
                                        {activeVersion?.id && (
                                          <div className="absolute top-0.5 right-0.5 flex items-center gap-0.5">
                                            <label
                                              title={`Upload an image for the ${label} view`}
                                              className="inline-flex items-center justify-center w-5 h-5 rounded bg-white/90 border border-emerald-200 text-emerald-700 hover:bg-emerald-50 cursor-pointer shadow-sm"
                                            >
                                              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                                              <input
                                                type="file"
                                                accept="image/*"
                                                className="hidden"
                                                disabled={busy}
                                                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadViewImage(k, f); e.currentTarget.value = ""; }}
                                              />
                                            </label>
                                            {url && (
                                              <button
                                                type="button"
                                                title={`Delete the ${label} view`}
                                                onClick={() => handleDeleteView(k)}
                                                disabled={busy}
                                                className="inline-flex items-center justify-center w-5 h-5 rounded bg-white/90 border border-red-200 text-red-600 hover:bg-red-50 shadow-sm disabled:opacity-50"
                                              >
                                                <Trash2 className="w-3 h-3" />
                                              </button>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                                {views.length
                                  ? <button type="button" onClick={() => setShow3DProofSheet(true)} className="mt-2 text-[11px] font-semibold text-violet-700 hover:underline">Open formatted 3D proof sheet →</button>
                                  : <p className="text-[11px] text-gray-500 italic text-center py-4">No 3D angles yet — press <span className="font-semibold">↻ Regenerate</span>, or upload one onto a slot above.</p>}
                              </div>)}
                          </div>
                        );
                      })()}
                      {bg && (
                        <div>
                          <p className="text-[10px] font-semibold text-emerald-800 mb-1">Clean background</p>
                          <a href={bg} target="_blank" rel="noreferrer" className="block">
                            <img src={bg} alt="Clean background" className="w-full max-h-40 object-contain rounded bg-white border border-emerald-100" />
                          </a>
                        </div>
                      )}
                      {pngs.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-emerald-800 mb-1">Transparent element PNGs ({pngs.length})</p>
                          <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                            {pngs.map((u, i) => (
                              <HoverZoomThumb key={i} url={u} alt={`PNG ${i + 1}`}
                                className="block rounded border border-emerald-100 overflow-hidden bg-white aspect-square"
                                imgClassName="w-full h-full object-contain" />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* VERSIONS — all saved versions right here in Design Assets,
                          with hover-to-enlarge thumbnails, ⚪/⚫ colorway tags, a
                          one-click "Use", and a hover red-X to delete the gray slop. */}
                      {allVersions.length > 0 && (
                        <div id="approvepro-versions-strip" className="scroll-mt-24 rounded-lg transition-shadow">
                          <p className="text-[11px] font-semibold text-emerald-800 mb-1.5">Versions ({allVersions.length}) — tap image to enlarge · Use · ✕ Delete (works on any version)</p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                            {allVersions.map((v) => {
                              const vru = (v.render_urls || {}) as Record<string, string>;
                              const vt = vru.hero || vru.side || vru["passenger-side"] || vru.production_proof || (v.uploaded_file_paths || [])[0] || null;
                              const vpt = (v.prompt_text || "").toLowerCase();
                              const cw = /\bwhite\b/.test(vpt) ? "⚪" : /\bblack\b/.test(vpt) ? "⚫" : "";
                              return (
                                <div key={v.id} className={cn("group relative rounded-lg border-2 overflow-hidden bg-white shadow-sm", v.is_active ? "border-[#0080dd] ring-2 ring-[#0080dd]/30" : "border-emerald-200")}>
                                  {vt ? (
                                    <a href={vt} target="_blank" rel="noreferrer" title="Open full size">
                                      <HoverZoomThumb url={vt} alt={`v${v.version_number}`} className="block aspect-video" imgClassName="w-full h-full object-cover" zoomSize={560} />
                                    </a>
                                  ) : (
                                    <div className="aspect-video bg-gray-50" />
                                  )}
                                  <div className="px-1.5 py-1 text-[11px] font-bold text-gray-700 flex items-center gap-1">{cw} v{v.version_number}{v.is_active && <span className="text-[#0080dd] ml-auto">● active</span>}</div>
                                  {/* Always-visible delete — works on ANY version (auto-switches if active) */}
                                  <button type="button" onClick={() => handleDeleteVersion(v.id, v.version_number, v.is_active)} title="Delete this version"
                                    className="absolute top-1 right-1 w-7 h-7 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center z-20 shadow">
                                    <X className="w-4 h-4" />
                                  </button>
                                  {!v.is_active && (
                                    <button type="button" onClick={() => handleUseVersion(v.id)} disabled={usingVersionId === v.id} title="Use this version"
                                      className="absolute inset-x-0 bottom-6 bg-[#0080dd] hover:bg-[#0066b3] text-white text-[11px] font-bold py-1 z-10">
                                      {usingVersionId === v.id ? "…" : "Use this"}
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* CLEAR + RE-IMPORT — when the whole design on this version
                          is wrong: wipe every angle + the 2D proof, then import the
                          correct one from Revision Studio (sets it as the active
                          version via proof-save-version). */}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {activeVersion?.id && Object.keys((activeVersion.render_urls || {})).length > 0 && (
                          <button
                            type="button"
                            onClick={handleDeleteAllViews}
                            disabled={viewBusyKey === "__all__"}
                            title="Remove every angle AND the 2D proof from this version — you can re-import or regenerate after."
                            className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-50 text-red-700 text-[10px] font-bold px-2 py-1 hover:bg-red-100 disabled:opacity-50"
                          >
                            {viewBusyKey === "__all__" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            Delete all (angles + 2D proof)
                          </button>
                        )}
                        {activeVersion?.id && proof2d && (
                          <button
                            type="button"
                            onClick={handleDelete2DProof}
                            title="Delete ONLY the 2D production proof on this version (the 3D angles + artboard stay). Use this to clear a wrong/mislabeled 2D proof, then regenerate."
                            className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-50 text-red-700 text-[10px] font-bold px-2 py-1 hover:bg-red-100"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete 2D proof
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setImportOpen(true)}
                          title="Paste a Revision Studio link or visualization ID to set THAT design as this proof's active version."
                          className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-blue-50 text-blue-700 text-[10px] font-bold px-2 py-1 hover:bg-blue-100"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                          Import design from Revision Studio
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* PROOF VIEWS strip — shown inline below xl (the right rail
                    takes over on xl+ for the ProductionFlow 3-column shell). */}
                <div className="xl:hidden">
                  <ProofViewsStrip
                    renderUrls={activeVersion?.render_urls}
                    uploadedPaths={activeVersion?.uploaded_file_paths}
                    activeUrl={displayHero}
                    onSelect={setHeroOverrideUrl}
                    onDelete={handleDeleteView}
                    busyKey={viewBusyKey}
                  />
                  {/* 2D + 3D proof cards on mobile — the desktop right-rail is
                      xl-only, so surface these here too. Scoped to xl:hidden, so
                      this cannot affect the desktop layout. */}
                  {(() => {
                    const ru = (activeVersion?.render_urls || {}) as Record<string, string>;
                    const p2d = ru.production_proof || ru.proof_2d || null;
                    const h3d = ru.hero || ru.side || null;
                    const has3d = ["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"].some((k) => ru[k]);
                    if (!p2d && !h3d) return null;
                    return (
                      <div className="grid grid-cols-2 gap-2 mt-2 px-3 pb-1">
                        <button type="button" onClick={() => setShow2DProofSheet(true)} className="rounded-lg border border-emerald-200 bg-white overflow-hidden text-left">
                          <div className="px-2 py-1 text-white text-[9px] font-bold uppercase tracking-wider" style={{ background: "linear-gradient(90deg,#059669,#10b981)" }}>📄 2D Proof</div>
                          {p2d ? <img src={p2d} alt="2D proof" className="w-full h-24 object-contain bg-white" loading="lazy" /> : <p className="text-[10px] text-gray-400 italic p-2">Tap to build</p>}
                        </button>
                        <button type="button" onClick={() => setShow3DProofSheet(true)} disabled={!has3d} className="rounded-lg border border-violet-200 bg-white overflow-hidden text-left disabled:opacity-50">
                          <div className="px-2 py-1 text-white text-[9px] font-bold uppercase tracking-wider" style={{ background: "linear-gradient(90deg,#7c3aed,#a855f7)" }}>📄 3D Proof</div>
                          {h3d ? <img src={h3d} alt="3D proof" className="w-full h-24 object-cover bg-white" loading="lazy" /> : <p className="text-[10px] text-gray-400 italic p-2">No 3D yet</p>}
                        </button>
                      </div>
                    );
                  })()}
                </div>

                <div className="p-5 space-y-4">
                  {/* ── Order Command Header ──────────────────────────────────
                      The at-a-glance state of the order + the four primary
                      actions, shown on EVERY tab so nothing is buried: design
                      thumbnail, status, customer, last customer message, latest
                      revision, and Design / Revise / Upload / Send. Pure UI over
                      existing handlers — no pipeline or A.C.E-brain changes. */}
                  <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                    <div className="flex items-start gap-3 p-3">
                      <button
                        type="button"
                        onClick={() => setShow2DProofSheet(true)}
                        className="shrink-0 w-[72px] h-[72px] rounded-lg border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center"
                        title={hasDesign ? "Open the proof" : "No design yet"}
                      >
                        {displayHero
                          ? <img src={displayHero} alt="Current design" className="w-full h-full object-cover" loading="lazy" />
                          : <span className="text-[10px] text-gray-400 px-1 text-center leading-tight">No design yet</span>}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[15px] font-extrabold text-gray-900 truncate max-w-[60%]">{selected.design_name || "Untitled order"}</span>
                          {(() => {
                            const map: Record<string, { c: string; Icon: any; label: string }> = {
                              draft: { c: "bg-gray-100 text-gray-700", Icon: Clock, label: "Draft" },
                              sent: { c: "bg-blue-100 text-blue-700", Icon: Send, label: "Sent" },
                              viewed: { c: "bg-indigo-100 text-indigo-700", Icon: Eye, label: "Viewed" },
                              revising: { c: "bg-amber-100 text-amber-700", Icon: RotateCw, label: "Revising" },
                              approved: { c: "bg-emerald-100 text-emerald-700", Icon: CheckCircle2, label: "Approved" },
                              declined: { c: "bg-rose-100 text-rose-700", Icon: AlertTriangle, label: "Declined" },
                              revoked: { c: "bg-gray-200 text-gray-600", Icon: XCircle, label: "Revoked" },
                              expired: { c: "bg-gray-200 text-gray-600", Icon: Clock, label: "Expired" },
                            };
                            const m = map[selected.status] || map.draft;
                            const I = m.Icon;
                            return <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold", m.c)}><I className="w-3 h-3" />{m.label}</span>;
                          })()}
                        </div>
                        <div className="text-[12px] text-gray-500 truncate">
                          {selected.customer_name || "—"}
                          {vehicleOf(selected) ? ` · ${vehicleOf(selected)}` : ""}
                          {` · ${revisionCount} version${revisionCount === 1 ? "" : "s"}`}
                          {uploadsCount ? ` · ${uploadsCount} upload${uploadsCount === 1 ? "" : "s"}` : ""}
                        </div>
                        {latestVersion?.prompt_text && (
                          <div className="text-[12px] text-gray-600 mt-1 truncate">
                            <span className="font-semibold text-violet-700">Latest revision:</span> “{latestVersion.prompt_text}”
                          </div>
                        )}
                        {lastCustomerMsg && (
                          <div className="text-[12px] text-gray-600 truncate">
                            <span className="font-semibold text-blue-700">Customer:</span> “{lastCustomerMsg.text}”
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Primary actions — the four things you do to an order, un-buried. */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-gray-100 border-t border-gray-100">
                      <button
                        type="button"
                        onClick={handleGenerate3DProof}
                        disabled={busyAction === "autogen"}
                        className="flex items-center justify-center gap-1.5 bg-white py-2.5 text-[12px] font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        title="Generate / regenerate the full proof set (artboard → 7 angles → 2D proof)"
                      >
                        {busyAction === "autogen" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4 text-violet-600" />}
                        {hasDesign ? "Regenerate" : "Generate"}
                      </button>
                      <button
                        type="button"
                        onClick={openAceRevise}
                        disabled={!hasDesign}
                        className="flex items-center justify-center gap-1.5 bg-white py-2.5 text-[12px] font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        title="Open A.C.E and prompt it directly — type or speak the exact edit"
                      >
                        <Sparkles className="w-4 h-4 text-pink-600" />
                        Revise with A.C.E
                      </button>
                      <button
                        type="button"
                        onClick={() => aceFileInputRef.current?.click()}
                        disabled={aceUploading}
                        className="flex items-center justify-center gap-1.5 bg-white py-2.5 text-[12px] font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        title="Attach reference art, screenshots, logos, or instructions"
                      >
                        {aceUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4 text-blue-600" />}
                        Upload
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSendPortalEmail("request")}
                        disabled={isTerminal(selected.status) || busyAction === "portal-email"}
                        className="flex items-center justify-center gap-1.5 bg-white py-2.5 text-[12px] font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        title="Email the customer their approval link"
                      >
                        {busyAction === "portal-email" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 text-emerald-600" />}
                        Send
                      </button>
                    </div>
                  </div>

                  {/* Detail tabs — gradient TAG pills (each tab its own brand
                      color when active) so they read as real tags. */}
                  <div className="grid grid-cols-3 gap-1.5 sticky top-0 z-20">
                    {(["workorder", "design", "truth"] as const).map((k) => {
                      const active = detailTab === k;
                      const grad = k === "workorder"
                        ? "linear-gradient(135deg,#0066cc,#00a8e8)"
                        : k === "design"
                          ? "linear-gradient(135deg,#3b82f6,#ec4899)"
                          : "linear-gradient(135deg,#7c3aed,#a855f7)";
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setDetailTab(k)}
                          style={active ? { background: grad } : undefined}
                          className={cn(
                            "h-9 rounded-full text-[12px] font-bold transition-all border",
                            active
                              ? "text-white shadow-sm border-transparent"
                              : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50",
                          )}
                        >
                          {k === "workorder" ? "Work Order" : k === "design" ? "Design & Send" : "Source of Truth"}
                        </button>
                      );
                    })}
                  </div>

                  <div className={cn("space-y-4", detailTab !== "workorder" && "hidden")}>
                  {/* Intake status — the FIRST thing: do we have relevant
                      instructions? If not, say so plainly, show the parsed-email
                      result + the portal-invite trail, and offer GO / resend.
                      Sits ABOVE (separate from) the progress bar. */}
                  <ProofIntakeStatus
                    proof={selected}
                    events={replyEvents}
                    portalUrl={`${getPublicBase()}/approve/${selected.view_token}`}
                    onResendInvite={() => handleSendPortalEmail("request")}
                    onGo={() => handleAgentGo()}
                    busy={busyAction === "agent-go" || goingId === selected.id || busyAction === "portal-email"}
                  />
                  {/* Progress stepper */}
                  <ProofProgressStepper
                    status={selected.status}
                    hasUploadedFiles={!!(activeVersion?.uploaded_file_paths?.length)}
                    hasRenderUrls={
                      // Only count REAL generated renders. WPW auto-ingest
                      // seeds render_urls with the WooCommerce product
                      // thumbnail (weprintwraps.com/...) so the list rail has
                      // an image — that is NOT a render and must not light up
                      // "3D Generated"/"Proof Built" on a fresh draft.
                      Object.values(activeVersion?.render_urls || {}).some(
                        (u) => typeof u === "string" && u && !u.includes("weprintwraps.com"),
                      )
                    }
                    hasSentAt={!!selected.sent_at}
                  />

                  {/* One cohesive top-to-bottom flow — no tab-hopping. The job
                      reads in the order a designer works it: understand it
                      (Work Order) → build it (Design) → send + converse
                      (Send & Replies). */}
                  <div className="space-y-8">
                    {/* ── 1 · Work Order ── */}
                    <section className="space-y-4 scroll-mt-20">
                      <div className="flex items-center gap-2 pb-1.5 border-b-2 border-gray-900/10">
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-900 text-white text-xs font-bold shrink-0">1</span>
                        <h2 className="text-base font-bold text-gray-900">Work Order</h2>
                        <span className="text-xs text-gray-500 hidden sm:inline">— what to make &amp; for whom</span>
                      </div>

                  {/* Order header — bold, black, everything the designer
                      needs to triage the job sits up top and readable. */}
                  <div>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        {(selected.metadata?.wpw_order_number || selected.metadata?.wpw_woo_order_id) && (
                          <div className="text-2xl font-extrabold text-gray-900 leading-tight">
                            Order #{selected.metadata?.wpw_order_number || selected.metadata?.wpw_woo_order_id}
                          </div>
                        )}
                        <h2
                          className={cn(
                            "font-bold text-gray-900",
                            (selected.metadata?.wpw_order_number || selected.metadata?.wpw_woo_order_id)
                              ? "text-base mt-0.5"
                              : "text-2xl",
                          )}
                        >
                          {selected.design_name || "Vehicle Wrap Design"}
                        </h2>
                        {(vehicleOf(selected) || selected.finish_type) && (
                          <p className="text-sm font-medium text-gray-700 mt-0.5">
                            {vehicleOf(selected)}
                            {vehicleOf(selected) && selected.finish_type ? " · " : ""}
                            {selected.finish_type || ""}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        {formatCurrency(linkedOrder?.total, linkedOrder?.currency) && (
                          <div className="text-lg font-bold text-gray-900 leading-none">
                            {formatCurrency(linkedOrder?.total, linkedOrder?.currency)}
                            <span className="ml-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                              Paid
                            </span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handlePrintWorkOrder}
                            className="h-8 gap-1 border-gray-300 text-gray-900 hover:bg-gray-50 font-semibold"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            Print work order
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleSendToProduction}
                            disabled={sendingToProduction}
                            className="h-8 gap-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold"
                          >
                            {sendingToProduction
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <Package className="w-3.5 h-3.5" />}
                            Order Production Pack
                          </Button>
                        </div>
                      </div>
                    </div>
                    {/* Customer identity — black + prominent. "Change email"
                        toggles the edit form rendered further below. */}
                    <div className="mt-2 flex items-center gap-x-4 gap-y-1 flex-wrap text-sm">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-gray-900">
                        <User className="w-4 h-4 text-gray-700" />
                        {selected.customer_name || "—"}
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-gray-900 min-w-0">
                        <Mail className="w-4 h-4 text-gray-700 shrink-0" />
                        <span className="truncate">{selected.customer_email}</span>
                      </span>
                      {selected.customer_phone && (
                        <span className="inline-flex items-center gap-1.5 text-gray-900">
                          <span className="text-gray-700 text-[12px]">☎</span>
                          {selected.customer_phone}
                        </span>
                      )}
                      {!isTerminal(selected.status) && !editingCustomer && (
                        <Button
                          onClick={startEditCustomer}
                          size="sm"
                          className="h-7 px-2.5 text-xs gap-1 bg-blue-600 text-white hover:bg-blue-700 border-0"
                        >
                          <FileText className="w-3 h-3" />
                          Change email
                        </Button>
                      )}
                    </div>

                    {/* WPW-linked proofs: show the full Work Order sheet
                        (same clean layout as the printable page) so the
                        designer sees customer, ship/bill, every line item
                        with SKU + qty + price, totals, and uploaded files
                        in one readable place. */}
                    {linkedOrder && (
                      <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                        <WorkOrderSheet order={linkedOrder} hideHeader />
                      </div>
                    )}

                    {/* Fallback for non-WPW proofs (manually created) — the
                        proof's own metadata blocks. */}
                    {!linkedOrder && (
                    <>
                    {Array.isArray(selected.metadata?.line_items) && selected.metadata.line_items.length > 0 && (
                      <div className="mt-2 rounded-md border border-purple-200 bg-purple-50/50 p-2">
                        <p className="text-[10px] font-semibold text-purple-900 uppercase tracking-wider mb-1">
                          Products on this order
                        </p>
                        <ul className="space-y-0.5">
                          {selected.metadata.line_items.slice(0, 8).map((li: any, i: number) => (
                            <li key={i} className="text-[12px] text-purple-900 flex items-center gap-1.5">
                              <span className="text-purple-400">·</span>
                              <span className="font-medium">{li.name || `Item ${i + 1}`}</span>
                              {li.quantity && li.quantity > 1 && (
                                <span className="text-purple-700/70">× {li.quantity}</span>
                              )}
                            </li>
                          ))}
                          {selected.metadata.line_items.length > 8 && (
                            <li className="text-[10px] text-purple-700/70">
                              + {selected.metadata.line_items.length - 8} more
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                    {/* Order-level "Customer provided note" — the field
                        the customer types right on the WooCommerce checkout.
                        Usually contains vehicle info / overall direction. */}
                    {typeof selected.metadata?.order_customer_note === "string" && selected.metadata.order_customer_note.length > 0 && (
                      <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50/70 p-2">
                        <p className="text-[10px] font-semibold text-emerald-900 uppercase tracking-wider mb-1">
                          Customer provided note (from checkout)
                        </p>
                        <p className="text-[12px] text-emerald-950 whitespace-pre-wrap leading-snug">
                          {selected.metadata.order_customer_note}
                        </p>
                      </div>
                    )}
                    {/* Line-item brief — the answer to the product's
                        "Please describe the project" form field. */}
                    {(() => {
                      const brief = (selected.metadata?.line_item_brief as string | undefined)
                        || (typeof selected.metadata?.customer_note === "string"
                          && selected.metadata.customer_note.length > 0
                          && selected.metadata.customer_note !== selected.metadata?.order_customer_note
                          ? selected.metadata.customer_note
                          : null);
                      if (!brief) return null;
                      // If the combined customer_note still has the order
                      // note prefix, strip it so we don't show it twice.
                      const orderNote = selected.metadata?.order_customer_note as string | undefined;
                      const trimmed = orderNote && brief.startsWith(orderNote)
                        ? brief.slice(orderNote.length).replace(/^\s*\n+/, "").trim()
                        : brief;
                      if (!trimmed) return null;
                      return (
                        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50/60 p-2">
                          <p className="text-[10px] font-semibold text-amber-900 uppercase tracking-wider mb-1">
                            Customer's design request (please describe…)
                          </p>
                          <p className="text-[12px] text-amber-950 whitespace-pre-wrap leading-snug">
                            {trimmed}
                          </p>
                        </div>
                      );
                    })()}
                    {Array.isArray(selected.metadata?.customer_uploads) && selected.metadata.customer_uploads.length > 0 && (
                      <div className="mt-2 rounded-md border border-blue-200 bg-blue-50/40 p-2">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <p className="text-[10px] font-semibold text-blue-900 uppercase tracking-wider">
                            Customer's reference uploads ({selected.metadata.customer_uploads.length})
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              const urls = selected.metadata?.customer_uploads as string[] || [];
                              for (let i = 0; i < urls.length; i++) {
                                await downloadFile(urls[i]);
                                // Stagger so the browser doesn't merge them
                                // into a single download prompt.
                                if (i < urls.length - 1) await new Promise((r) => setTimeout(r, 300));
                              }
                              toast({ title: "Downloading", description: `${urls.length} image${urls.length === 1 ? "" : "s"} — check your Downloads folder.` });
                            }}
                            className="h-6 px-2 text-[10px] gap-1 bg-white border-blue-300 text-blue-700 hover:bg-blue-100"
                          >
                            <Download className="w-3 h-3" />
                            Download all
                          </Button>
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                          {selected.metadata.customer_uploads.map((url: string, i: number) => (
                            <div
                              key={i}
                              className="relative group rounded border border-blue-200 bg-white overflow-hidden hover:border-blue-400 transition-colors"
                            >
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="block"
                                title="Open full size in new tab"
                              >
                                <img
                                  src={url}
                                  alt={`Customer upload ${i + 1}`}
                                  loading="lazy"
                                  className="w-full aspect-square object-cover"
                                />
                              </a>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  downloadFile(url);
                                }}
                                title="Download image"
                                className="absolute top-1 right-1 inline-flex items-center justify-center w-6 h-6 rounded-md bg-white/95 text-blue-700 border border-blue-200 shadow-sm opacity-0 group-hover:opacity-100 hover:bg-blue-50 transition-opacity"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {Array.isArray(selected.metadata?.customer_documents) && selected.metadata.customer_documents.length > 0 && (
                      <div className="mt-2 rounded-md border border-violet-200 bg-violet-50/40 p-2">
                        <p className="text-[10px] font-semibold text-violet-900 uppercase tracking-wider mb-1.5">
                          Customer's reference documents ({selected.metadata.customer_documents.length})
                        </p>
                        <ul className="space-y-1">
                          {selected.metadata.customer_documents.map((url: string, i: number) => {
                            const filename = (() => {
                              try { return decodeURIComponent(new URL(url).pathname.split("/").pop() || `Document ${i + 1}`); }
                              catch { return `Document ${i + 1}`; }
                            })();
                            const ext = (filename.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
                            return (
                              <li key={i} className="flex items-center gap-1">
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded bg-white border border-violet-200 hover:border-violet-400 hover:bg-violet-50 text-[12px] text-violet-900 transition-colors"
                                >
                                  <FileText className="w-3.5 h-3.5 text-violet-600 shrink-0" />
                                  <span className="truncate flex-1">{filename}</span>
                                  {ext && (
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded">
                                      {ext}
                                    </span>
                                  )}
                                </a>
                                <button
                                  type="button"
                                  onClick={() => downloadFile(url, filename)}
                                  title="Download file"
                                  className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-white text-violet-700 border border-violet-200 hover:bg-violet-50 transition-colors shrink-0"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                    </>
                    )}
                  </div>

                  {/* ── Give A.C.E context, then GO ──
                      The operator can type instructions AND/OR upload the
                      customer's art right here, then press GO. ApprovePro
                      routes the job itself: art attached → RecreatePro
                      (recreate it faithfully, edits from the text); text only
                      → DesignPro (design fresh). Same GO the rows use. */}
                  {!isTerminal(selected.status) && (
                    <div className="rounded-xl border-2 border-blue-200/70 bg-white shadow-sm overflow-hidden">
                      {/* Tool header bar — proprietary ApprovePro engine identity */}
                      <div className="flex items-center gap-3 px-4 py-3 text-white" style={{ background: "linear-gradient(135deg,#3b82f6,#8b5cf6,#ec4899)" }}>
                        <img src="/characters/ace-desk-branded.png" alt="A.C.E" className="w-11 h-11 rounded-lg object-contain bg-white/20 ring-1 ring-white/30 p-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
                            <span className="text-xl font-extrabold leading-none tracking-tight">A.C.E<span className="text-sm align-top">™</span></span>
                            <span className="text-[13px] font-bold text-white/95 tracking-wide uppercase">AI Creative Engine</span>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-white/20 text-[11px] font-bold">ApprovePro™</span>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-white/20 text-[11px] font-bold">DesignPro™</span>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-white/20 text-[11px] font-bold">RecreatePro™</span>
                          </div>
                          <p className="text-[13px] text-white/90 leading-snug mt-1 font-medium">
                            Give A.C.E — the AI Creative Engine — context, press GO, and it designs the wrap.
                          </p>
                        </div>
                      </div>

                      <div className="p-4 space-y-3">
                        <p className="text-sm text-gray-700 leading-relaxed">
                          Drop in <strong className="text-fuchsia-700">art, screenshots, or annotated photos</strong> and/or type the
                          instructions. A.C.E reads the text <em>inside</em> screenshots and the marks on photos, then routes it:
                          <strong className="text-fuchsia-700"> recreate</strong> (RecreatePro) or <strong className="text-blue-700">design fresh</strong> (DesignPro).
                        </p>
                        <Textarea
                          value={aceBrief}
                          onChange={(e) => setAceBrief(e.target.value)}
                          placeholder="e.g. Recreate the attached design on this truck, change the blue to matte black, keep the logo on the doors…"
                          className="bg-white text-gray-900 placeholder:text-gray-400 text-base min-h-[96px] border-gray-300 focus-visible:ring-blue-500"
                        />
                        <input
                          ref={aceFileInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(e) => handleAceUpload(e.target.files)}
                        />
                        <div className="flex flex-wrap items-center gap-2.5">
                          <Button
                            disabled={aceUploading}
                            variant="outline"
                            onClick={() => aceFileInputRef.current?.click()}
                            title="Upload art, screenshots, or annotated photos — A.C.E reads the instructions inside them"
                            className="h-12 px-4 gap-2 text-[15px] border-2 border-blue-300 text-blue-700 hover:bg-blue-50 font-bold"
                          >
                            {aceUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5" />}
                            Upload art / screenshots
                          </Button>
                          <Button
                            disabled={busyAction === "agent-go" || goingId === selected.id || aceUploading}
                            onClick={handleSaveContextAndGo}
                            title="Save this context and run A.C.E — recreate (uploads) or design (text), then it appears here as a new version"
                            className="h-12 px-6 gap-2 text-[15px] font-extrabold text-white border-0 shadow-sm flex-1 sm:flex-none hover:brightness-110"
                            style={{ background: "linear-gradient(135deg,#3b82f6,#8b5cf6,#ec4899)" }}
                          >
                            {(busyAction === "agent-go" || goingId === selected.id)
                              ? <Loader2 className="w-5 h-5 animate-spin" />
                              : <Rocket className="w-5 h-5" />}
                            Save &amp; GO
                          </Button>
                        </div>
                        {Array.isArray(selected.metadata?.customer_uploads) && selected.metadata.customer_uploads.length > 0 && (
                          <p className="text-[13px] font-bold text-fuchsia-700">
                            {selected.metadata.customer_uploads.length} reference{selected.metadata.customer_uploads.length === 1 ? "" : "s"} attached → GO will recreate (RecreatePro)
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {editingCustomer ? (
                    <div className="rounded-md border border-blue-200 bg-blue-50/40 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Label className="text-xs font-semibold text-blue-900">
                          Edit customer info
                        </Label>
                        <p className="text-[10px] text-blue-900/70">
                          Used on the next Send / Resend.
                        </p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="space-y-0.5">
                          <Label htmlFor="cust-email-edit" className="text-[10px] text-zinc-700">
                            Email <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            id="cust-email-edit"
                            type="email"
                            value={customerEmailDraft}
                            onChange={(e) => setCustomerEmailDraft(e.target.value)}
                            placeholder="brian@galvinhr.com"
                            disabled={savingCustomer}
                            className="bg-white text-zinc-900 placeholder:text-gray-700 h-8 text-sm"
                          />
                        </div>
                        <div className="space-y-0.5">
                          <Label htmlFor="cust-name-edit" className="text-[10px] text-zinc-700">
                            Name
                          </Label>
                          <Input
                            id="cust-name-edit"
                            value={customerNameDraft}
                            onChange={(e) => setCustomerNameDraft(e.target.value)}
                            placeholder="Brian Galvin"
                            disabled={savingCustomer}
                            className="bg-white text-zinc-900 placeholder:text-gray-700 h-8 text-sm"
                          />
                        </div>
                        <div className="space-y-0.5">
                          <Label htmlFor="cust-phone-edit" className="text-[10px] text-zinc-700">
                            Phone
                          </Label>
                          <Input
                            id="cust-phone-edit"
                            type="tel"
                            value={customerPhoneDraft}
                            onChange={(e) => setCustomerPhoneDraft(e.target.value)}
                            placeholder="612-555-1234"
                            disabled={savingCustomer}
                            className="bg-white text-zinc-900 placeholder:text-gray-700 h-8 text-sm"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <Button
                          onClick={() => setEditingCustomer(false)}
                          variant="ghost"
                          size="sm"
                          disabled={savingCustomer}
                          className="h-7 text-xs"
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleSaveCustomer}
                          disabled={savingCustomer || !customerEmailDraft.trim()}
                          size="sm"
                          className="h-7 text-xs gap-1 bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:opacity-90 border-0"
                        >
                          {savingCustomer ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Save className="w-3 h-3" />
                          )}
                          Save customer
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  {/* Loud banner: if the proof is still pointed at the
                      shop's own email, flag it so the shop doesn't keep
                      "resending" to themselves wondering why the customer
                      never gets it. */}
                  {!editingCustomer && !isTerminal(selected.status) && /weprintwraps|restyleproai/i.test(selected.customer_email) && (
                    <div className="rounded-md border-2 border-amber-300 bg-amber-50 p-3 flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <p className="text-sm font-bold text-amber-900">
                          Heads up — this proof is set to email YOU, not the customer.
                        </p>
                        <p className="text-[12px] text-amber-800 mt-0.5">
                          <span className="font-mono">{selected.customer_email}</span> · Click <strong>Change email</strong> above to swap to the real customer's address before you click Resend.
                        </p>
                      </div>
                      <Button
                        onClick={startEditCustomer}
                        size="sm"
                        className="bg-amber-600 text-white hover:bg-amber-700 border-0 gap-1 shrink-0"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Change customer email
                      </Button>
                    </div>
                  )}

                  {/* Line items summary — Phase 8C */}
                  {selected.has_line_items && lineItemRows.length > 0 && (
                    <div className="rounded-md border border-gray-200 bg-white">
                      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
                        <span className="text-xs font-semibold text-gray-600">
                          Line items ({lineItemRows.length})
                        </span>
                        <span className="text-[10px] text-gray-800">
                          {lineItemRows.filter((li) => li.status === "approved").length} approved
                          · {lineItemRows.filter((li) => li.status === "declined").length} declined
                          · {lineItemRows.filter((li) => li.status === "revising").length} revising
                          · {lineItemRows.filter((li) => li.status === "pending").length} pending
                        </span>
                      </div>
                      <ul className="divide-y divide-zinc-100">
                        {lineItemRows.map((li) => {
                          const statusClass =
                            li.status === "approved" ? "bg-green-100 text-green-700 border-green-200" :
                            li.status === "declined" ? "bg-red-100 text-red-700 border-red-200" :
                            li.status === "revising" ? "bg-purple-100 text-purple-700 border-purple-200" :
                            "bg-gray-100 text-gray-600 border-gray-200";
                          return (
                            <li key={li.id} className="px-3 py-2 flex items-start gap-2.5">
                              <span className="text-[10px] font-semibold text-gray-700 mt-0.5 w-5">
                                #{li.line_number}
                              </span>
                              {li.render_url && (
                                <img
                                  src={li.render_url}
                                  alt=""
                                  className="w-10 h-10 rounded object-cover border border-gray-200 shrink-0"
                                />
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-medium truncate">{li.title}</p>
                                  <Badge variant="outline" className={cn("text-[9px] h-4 px-1.5 shrink-0", statusClass)}>
                                    {li.status}
                                  </Badge>
                                </div>
                                {(li.status === "declined" && li.decline_reason) && (
                                  <p className="text-[11px] text-red-700 mt-0.5 line-clamp-2">
                                    <span className="font-semibold">Declined:</span> {li.decline_reason}
                                  </p>
                                )}
                                {(li.status === "revising" && li.change_request) && (
                                  <p className="text-[11px] text-purple-800 mt-0.5 line-clamp-2">
                                    <span className="font-semibold">Revise:</span> {li.change_request}
                                  </p>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {/* Customer revision notes (if any) */}
                  {selected.change_request && selected.status === "revising" && (
                    <div className="rounded-md border border-purple-200 bg-purple-50 p-3 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-900">
                        <RotateCw className="w-3.5 h-3.5" />
                        Customer revision notes
                      </div>
                      <p className="text-sm text-gray-800 whitespace-pre-wrap">
                        {selected.change_request}
                      </p>
                    </div>
                  )}

                  {selected.decline_reason && selected.status === "declined" && (
                    <div className="rounded-md border border-red-200 bg-red-50 p-3 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-red-900">
                        <XCircle className="w-3.5 h-3.5" />
                        Decline reason
                      </div>
                      <p className="text-sm text-gray-800 whitespace-pre-wrap">
                        {selected.decline_reason}
                      </p>
                    </div>
                  )}

                    </section>
                  </div>{/* /Work Order tab */}

                    {/* ── 2 · Design ── */}
                    <div className={cn(detailTab !== "design" && "hidden")}>
                    <section className="space-y-4 scroll-mt-20">
                      <DesignTabEmbed proofId={selected.id} />
                      {/* Design Assets for THIS order — the artboard, clean
                          background, lifted transparent layers, and golden print
                          panels generated for the order. Linked via
                          proof_approvals.source_visualization_id (set by
                          approvepro-autogen-design). Read-only viewer. */}
                      {sotGenId && (
                        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
                          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
                            <div>
                              <h3 className="text-base font-bold text-gray-900">Design Assets</h3>
                              <p className="text-xs text-gray-500">Artboard, separated layers &amp; print files for this order</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {/* Open this order's 2D proof straight into Panel Studio
                                  (reverse-RecreatePro / panelize), prefilled via URL. */}
                              <a
                                href={`/admin/wrap-panel-studio?${new URLSearchParams({
                                  ...(productionProofUrl(activeVersion) ? { proof_url: productionProofUrl(activeVersion)! } : {}),
                                  ...(vehicleOf(selected) ? { vehicle: vehicleOf(selected) } : {}),
                                  ...(selected.design_name ? { project: selected.design_name } : {}),
                                }).toString()}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-800 hover:bg-violet-100"
                              >
                                <Layers className="w-3.5 h-3.5" /> Panel Studio ↗
                              </a>
                              <a
                                href={`/design-assets/${sotGenId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-gray-50"
                              >
                                Open in DesignPro Assets ↗
                              </a>
                            </div>
                          </div>
                          <DesignAssetsPanel generationId={sotGenId} />
                          <div className="px-4 pb-4">
                            <LiftedAssetsCards generationId={sotGenId} />
                          </div>
                        </div>
                      )}
                    </section>
                    </div>{/* /Design tab (section 2) */}

                    {/* ── 3 · Send &amp; Replies ── */}
                    <section className="space-y-4 scroll-mt-20">
                    <div className={cn("space-y-4", detailTab !== "design" && "hidden")}>
                      <div className="flex items-center gap-2 pb-1.5 border-b-2 border-gray-900/10">
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-900 text-white text-xs font-bold shrink-0">3</span>
                        <h2 className="text-base font-bold text-gray-900">Send &amp; Replies</h2>
                        <span className="text-xs text-gray-500 hidden sm:inline">— email the customer &amp; handle responses</span>
                      </div>

                  {/* Message to customer (sent in proof email) */}
                  {!isTerminal(selected.status) && (
                    <div className="rounded-md border border-cyan-200 bg-cyan-50/40 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-1.5 text-xs font-semibold text-cyan-900">
                          <Mail className="w-3.5 h-3.5" />
                          {selected.status === "draft" ? "Message to customer (goes in the email)" : "Message to customer (used on next Send / Resend)"}
                        </label>
                        <Button
                          onClick={handleSaveMessage}
                          disabled={savingMessage || messageDraft === (selected.message_to_customer || "")}
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1 border-cyan-400 text-cyan-700 hover:bg-cyan-50"
                        >
                          {savingMessage ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Save className="w-3 h-3" />
                          )}
                          Save message
                        </Button>
                      </div>
                      <Textarea
                        value={messageDraft}
                        onChange={(e) => setMessageDraft(e.target.value)}
                        placeholder={"e.g. Hi! Here's your wrap design — let me know if any tweaks are needed before we go to print. Thanks!"}
                        rows={3}
                        className="text-sm bg-white text-gray-900 placeholder:text-gray-400 border-cyan-200"
                        disabled={savingMessage}
                      />
                      <p className="text-[10px] text-cyan-900/70">
                        Customer sees this above the Approve / Decline buttons in the proof email. Saved message is included automatically the next time you Send or Resend.
                      </p>
                    </div>
                  )}

                  {/* The customer conversation (thread + reply composer with
                      AI rewrite) lives in the "Customer replies" section lower
                      in this tab — one place, no duplicate composer. */}

                  {/* Source of Truth + Validation Checklist — side by side */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <ProofSourceOfTruth
                      customerName={selected.customer_name}
                      customerEmail={selected.customer_email}
                      customerPhone={selected.customer_phone}
                      vehicleYear={selected.vehicle_year}
                      vehicleMake={selected.vehicle_make}
                      vehicleModel={selected.vehicle_model}
                      designName={selected.design_name}
                      finishType={selected.finish_type}
                      mode={selected.mode}
                      metadata={selected.metadata}
                      createdAt={selected.created_at}
                    />
                    <ProofValidationChecklist
                      customerEmail={selected.customer_email}
                      customerName={selected.customer_name}
                      vehicleYear={selected.vehicle_year}
                      vehicleMake={selected.vehicle_make}
                      vehicleModel={selected.vehicle_model}
                      designName={selected.design_name}
                      hasRenderOrUpload={!!(hero || activeVersion?.uploaded_file_paths?.length)}
                      status={selected.status}
                    />
                  </div>

                  {/* Action buttons */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <Button
                      onClick={() => window.open(`/approve/${selected.view_token}`, "_blank")}
                      variant="outline"
                      size="sm"
                      className="gap-1"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Preview as client
                    </Button>
                    <Button
                      onClick={handleCopyLink}
                      variant="outline"
                      size="sm"
                      className="gap-1"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Copy link
                    </Button>
                    <Button
                      onClick={() => handleSendPortalEmail("request")}
                      disabled={!selected.customer_email || busyAction === "portal-email"}
                      variant="outline"
                      size="sm"
                      title="Email the customer a branded link to add their design brief + examples on the portal"
                      className="gap-1 border-pink-300 text-pink-700 hover:bg-pink-50 hover:text-pink-800"
                    >
                      {busyAction === "portal-email" ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      Email design portal
                    </Button>
                    <Button
                      onClick={() => setSendProofOpen(true)}
                      disabled={isTerminal(selected.status) || busyAction === "resend"}
                      size={selected.status === "draft" ? "default" : "sm"}
                      className={cn(
                        "gap-1 border-0",
                        selected.status === "draft"
                          ? "col-span-2 sm:col-span-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white hover:opacity-90 text-base font-semibold"
                          : "bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:opacity-90"
                      )}
                    >
                      {busyAction === "resend" ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                      {selected.status === "draft" ? "Send Proof to Customer" : selected.status === "delivery_failed" ? "Retry email" : "Resend email"}
                    </Button>
                    <Button
                      onClick={() => setShowEscalate(true)}
                      disabled={isTerminal(selected.status) || selected.status === "escalated_support"}
                      variant="outline"
                      size="sm"
                      className="gap-1 border-amber-400 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                    >
                      <LifeBuoy className="w-3.5 h-3.5" />
                      Escalate to Support
                    </Button>
                    <Button
                      onClick={handleRevoke}
                      disabled={isTerminal(selected.status) || busyAction === "revoke"}
                      variant="outline"
                      size="sm"
                      className="gap-1 border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800"
                    >
                      {busyAction === "revoke" ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5" />
                      )}
                      Revoke
                    </Button>
                  </div>

                  {/* Internal notes */}
                  <div className="space-y-2 pt-2 border-t border-gray-200">
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-800">
                        <FileText className="w-3.5 h-3.5" />
                        Internal notes (shop-only)
                      </label>
                      <Button
                        onClick={handleSaveNotes}
                        disabled={savingNotes || notesDraft === (selected.internal_notes || "")}
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                      >
                        {savingNotes ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Save className="w-3 h-3" />
                        )}
                        Save
                      </Button>
                    </div>
                    <Textarea
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      placeholder="Notes for you and your team — not visible to the customer."
                      className="min-h-[90px] text-sm"
                      disabled={savingNotes}
                    />
                  </div>

                  {/* Attach design — pull from QC Artboard / DesignPro
                      OR upload fresh files. Both create a new version.
                      Allowed when status is "declined" so the shop can
                      send a revised version in response (re-opens the proof). */}
                  {(!isTerminal(selected.status) || selected.status === "declined") && (
                    <div className="space-y-3">
                      <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-4 flex items-center justify-between gap-3 flex-wrap">
                        <div>
                          <h3 className="text-sm font-semibold text-blue-900 flex items-center gap-2">
                            <Link2 className="w-4 h-4" />
                            Already designed in QC Artboard?
                          </h3>
                          <p className="text-[11px] text-blue-900/70 mt-0.5">
                            Pull the renders + 2D flat proof straight from your QC job — skip re-uploading.
                          </p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => setShowPullFromQC(true)}
                          className="gap-1.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:opacity-90 border-0 shrink-0"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                          Pull from QC Artboard
                        </Button>
                      </div>
                      {/* Attach a design made in DesignPro / Freestyle /
                          Re-create Pro — links it to this order so it becomes
                          the version AND the customer's Revise-with-AI works. */}
                      <button
                        type="button"
                        onClick={() => setAttachOpen(true)}
                        className="w-full flex items-center justify-center gap-2 rounded-xl border border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100 h-10 text-sm font-semibold transition-colors"
                      >
                        <Link2 className="w-4 h-4" />
                        Attach a design you made (DesignPro / Freestyle / Re‑create)
                      </button>
                      {/* Edit on our end — open THIS proof's design in
                          RevisionStudio, tweak with AI, then "Save to this
                          proof" pushes the edit back as a new version and lets
                          you email the customer. Carries proof_id so the round
                          trip lands on this exact order; uses the proof's source
                          visualization when present (full editing) and still
                          passes proof_id otherwise. */}
                      <button
                        type="button"
                        onClick={() => {
                          const p = new URLSearchParams();
                          if (selected.source_visualization_id) p.set("id", selected.source_visualization_id);
                          p.set("proof_id", selected.id);
                          // Carry the vehicle context so RevisionStudio can load
                          // the customer's CURRENT design even when this proof has
                          // no source_visualization_id (uploaded / older WPW
                          // orders). Without it the editor opened blank and the
                          // shop regenerated from scratch — which swapped the
                          // vehicle (trailer → car) and wiped the approved design.
                          if (selected.vehicle_year) p.set("v_year", String(selected.vehicle_year));
                          if (selected.vehicle_make) p.set("v_make", String(selected.vehicle_make));
                          if (selected.vehicle_model) p.set("v_model", String(selected.vehicle_model));
                          if (selected.design_name) p.set("v_name", String(selected.design_name));
                          // embed=1 → opens RevisionStudio IN PLACE (iframe overlay
                          // below), reusing this session. It saves back here via
                          // postMessage instead of a page bounce.
                          p.set("embed", "1");
                          setEditorUrl(`/revision-studio?${p.toString()}`);
                        }}
                        className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white h-11 text-sm font-bold hover:brightness-110 transition-colors"
                      >
                        <Sparkles className="w-4 h-4" />
                        Edit this design (surgical AI editor — opens here, keeps the wrap)
                      </button>
                      <p className="text-[11px] text-gray-500 -mt-1 px-1">
                        Use this for small fixes (spelling, a color, a logo) — it edits the
                        EXISTING design and saves a new version back here, keeping the wrap.
                      </p>
                      {/* START OVER — the deliberate, confirmed force-rebuild. The
                          ONLY way to throw away the current design and generate a
                          brand-new one from the brief (DesignPro). Kept visually
                          separate + low-key so it's never confused with "Edit". */}
                      <button
                        type="button"
                        onClick={handleStartOver}
                        disabled={busyAction === "autogen"}
                        className="w-full flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 h-10 text-[13px] font-semibold disabled:opacity-50 transition-colors"
                      >
                        <RotateCw className="w-4 h-4" />
                        {busyAction === "autogen" ? "Rebuilding…" : "Start over from brief (new DesignPro design)"}
                      </button>
                      <p className="text-[11px] text-gray-400 -mt-1 px-1">
                        Throws away the current design and builds a brand-new one from scratch. Only for a true do-over.
                      </p>
                      <ProofUploadVersion
                        proofId={selected.id}
                        onVersionSaved={() => {
                          loadList();
                          regenVersionProof();
                        }}
                      />
                      {/* Send right here — after Upload & Save Version you can
                          email the customer without scrolling away. */}
                      <button
                        type="button"
                        onClick={() => setSendProofOpen(true)}
                        disabled={isTerminal(selected.status) || busyAction === "resend"}
                        className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white h-11 text-sm font-bold hover:brightness-110 disabled:opacity-50"
                      >
                        <Mail className="w-4 h-4" />
                        {busyAction === "resend"
                          ? "Sending…"
                          : selected.status === "draft"
                            ? "Send proof to customer"
                            : "Re‑send proof to customer"}
                      </button>
                      {/* Text the proof link via SMS — the proof page is
                          mobile-first, so the customer can approve/revise with
                          AI straight from their phone. */}
                      <button
                        type="button"
                        onClick={handleTextProof}
                        disabled={isTerminal(selected.status) || busyAction === "text"}
                        className="w-full flex items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 h-11 text-sm font-bold disabled:opacity-50 transition-colors"
                      >
                        <MessageSquare className="w-4 h-4" />
                        {busyAction === "text" ? "Texting…" : "Text proof to customer (SMS)"}
                      </button>
                    </div>
                  )}

                  </div>{/* /Design & Send tab (section 3) */}
                  <div className={cn("space-y-4", detailTab !== "truth" && "hidden")}>

                  {/* VERSIONS & REVISIONS — FIRST thing on Source of Truth so it
                      can never be pushed under the fold. Each version with role +
                      exact date/time + the revision message the customer wrote.
                      This is the team's "is A.C.E working?" verification view.
                      Rendered directly from allVersions (no dependency on the
                      timeline component below), so it always shows when data exists. */}
                  <div className="rounded-lg border border-[#3b82f6]/40 bg-blue-50/30 p-4 space-y-2">
                    <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                      <RotateCw className="w-4 h-4 text-[#3b82f6]" />
                      Versions &amp; revisions
                      <span className="text-[10px] text-gray-700 ml-auto">{allVersions.length} version{allVersions.length !== 1 ? "s" : ""}</span>
                      {allVersions.length >= 2 && (
                        <button
                          type="button"
                          onClick={handleSendBothVersions}
                          disabled={bothBusy}
                          title="Combine the two most recent colorways (e.g. black + white) into ONE labeled comparison the customer sees in his proof"
                          className="inline-flex items-center rounded-md bg-[#3b82f6] text-white text-[10px] font-bold px-2 py-0.5 hover:brightness-110 disabled:opacity-50"
                        >
                          {bothBusy ? "Combining…" : "Send both colorways"}
                        </button>
                      )}
                      {allVersions.length > 0 && (
                        <button
                          type="button"
                          onClick={handleWipeVersions}
                          disabled={wiping}
                          title="Delete ALL versions/renders for this order and start fresh — cannot be undone."
                          className="inline-flex items-center rounded-md border border-red-300 bg-white text-red-600 text-[10px] font-bold px-2 py-0.5 hover:bg-red-50 disabled:opacity-50"
                        >
                          {wiping ? "Wiping…" : "🗑 Wipe & start fresh"}
                        </button>
                      )}
                    </h3>
                    {allVersions.length === 0 ? (
                      <p className="text-xs text-gray-700 italic">No versions yet.</p>
                    ) : (
                      <ol className="space-y-1.5">
                        {allVersions.map((v) => {
                          const who = v.created_by_role === "customer" ? "Customer revision"
                            : v.created_by_role === "system_upload" ? "Intake / upload"
                            : v.created_by_role === "designer" ? "Designer"
                            : (v.created_by_role || "—");
                          const when = v.created_at ? new Date(v.created_at).toLocaleString() : "";
                          // Thumbnail + colorway label so the team can SEE each
                          // saved version (e.g. the good White vs Black), not just
                          // a text row — every A.C.E render is here, nothing lost.
                          const ru = (v.render_urls || {}) as Record<string, string>;
                          const thumb = ru.hero || ru.side || ru["passenger-side"] || ru.front || ru.production_proof || (v.uploaded_file_paths || [])[0] || null;
                          const pt = (v.prompt_text || "").toLowerCase();
                          const colorway = /\bwhite\b/.test(pt) ? "⚪ White" : /\bblack\b/.test(pt) ? "⚫ Black" : null;
                          return (
                            <li key={v.id} className={cn("group relative rounded-md border p-2 text-[12px]", v.is_active ? "border-[#3b82f6] bg-white ring-1 ring-[#3b82f6]/20" : "border-gray-200 bg-white/70")}>
                              {!v.is_active && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteVersion(v.id, v.version_number, v.is_active)}
                                  title="Delete this version"
                                  className="absolute top-1 right-1 z-10 w-5 h-5 rounded-full bg-red-500/90 hover:bg-red-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                              <div className="flex gap-2.5">
                                {thumb ? (
                                  <a href={thumb} target="_blank" rel="noreferrer" className="shrink-0">
                                    <img src={thumb} alt={`v${v.version_number}`} loading="lazy" className="w-24 h-16 object-cover rounded border border-gray-200 bg-gray-100" />
                                  </a>
                                ) : (
                                  <div className="w-24 h-16 rounded border border-dashed border-gray-200 bg-gray-50 flex items-center justify-center text-[9px] text-gray-400 shrink-0">no render</div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-bold text-gray-900">v{v.version_number}</span>
                                    {colorway && <span className="text-[10px] font-bold text-gray-900">{colorway}</span>}
                                    {v.is_active && <span className="text-[9px] font-bold uppercase text-white bg-[#3b82f6] rounded px-1 py-0.5">Active</span>}
                                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{who}</span>
                                    <span className="text-[10px] text-gray-400 ml-auto">{when}</span>
                                  </div>
                                  {v.prompt_text && <p className="mt-0.5 text-gray-600 whitespace-pre-wrap break-words leading-snug line-clamp-2">{v.prompt_text}</p>}
                                  {!v.is_active && (
                                    <button
                                      type="button"
                                      onClick={() => handleUseVersion(v.id)}
                                      disabled={usingVersionId === v.id}
                                      title="Make this saved version the active one (nothing is deleted)"
                                      className="mt-1 inline-flex items-center rounded bg-[#3b82f6] text-white text-[10px] font-bold px-2 py-0.5 hover:brightness-110 disabled:opacity-50"
                                    >
                                      {usingVersionId === v.id ? "Switching…" : "Use this version →"}
                                    </button>
                                  )}
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>

                  {/* Original request — the prompt the customer actually wrote
                      (checkout note / line-item brief) + the art they uploaded
                      at checkout (metadata.customer_uploads). Shown FIRST and
                      always, so Source of Truth is never blank even when there's
                      no email/portal reply yet (the #1 "source of truth empty"
                      cause: KD-style orders whose brief + art came in at
                      checkout, not as a proof_event). */}
                  {(() => {
                    const md0 = (selected.metadata || {}) as any;
                    const origPrompt = [md0.order_customer_note, md0.line_item_brief, md0.customer_note]
                      .filter((s: any) => typeof s === "string" && s.trim())
                      .filter((s: any, i: number, arr: any[]) => arr.indexOf(s) === i)
                      .join("\n\n");
                    const ups: string[] = Array.isArray(md0.customer_uploads) ? md0.customer_uploads : [];
                    return (
                      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
                        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-[#3b82f6]" />
                          Original request — prompt &amp; uploads
                          <span className="text-[10px] text-gray-700 ml-auto">{ups.length} upload{ups.length !== 1 ? "s" : ""}</span>
                        </h3>
                        {origPrompt ? (
                          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1">What the customer asked for</p>
                            <p className="text-[12px] text-gray-800 whitespace-pre-wrap break-words leading-snug">{origPrompt}</p>
                          </div>
                        ) : (
                          <p className="text-xs text-gray-700 italic">No written prompt on this order.</p>
                        )}
                        {ups.length > 0 && (
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 mb-1">Customer uploaded ({ups.length})</p>
                            <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                              {ups.map((u, ui) => (
                                <a key={ui} href={u} target="_blank" rel="noreferrer" title="Open full size"
                                  className="block rounded border border-gray-200 overflow-hidden hover:border-blue-400 transition-colors">
                                  <img src={u} alt={`Upload ${ui + 1}`} loading="lazy" className="w-full aspect-square object-cover bg-white" />
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Inbound — every customer email/portal submission + whether
                      art was found (with thumbnails). The "what did they send
                      us, did it have art?" answer, up top. */}
                  <ProofIntakeHistory proof={selected} events={replyEvents} />

                  {/* Version History — always rendered so the shop sees a
                      clear empty state on draft proofs instead of a silently
                      missing section. Helps explain "blank history" for
                      proofs that haven't had any uploads yet. */}
                  <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
                    <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                      <RotateCw className="w-4 h-4 text-[#3b82f6]" />
                      Version History
                      <span className="text-[10px] text-gray-700 ml-auto">
                        {allVersions.length} version{allVersions.length !== 1 ? "s" : ""}
                      </span>
                    </h3>
                    {allVersions.length === 0 ? (
                      <p className="text-xs text-gray-700 italic">
                        No versions yet — upload artwork or pull from QC Artboard above to create the first version.
                      </p>
                    ) : (
                      <ProofVersionTimeline
                        versions={allVersions.map((v) => ({
                          ...v,
                          thumbnail_url: heroUrl(v as unknown as ActiveVersion),
                        }))}
                        onRevert={async (versionId) => {
                          const { data, error } = await supabase.functions.invoke("proof-revert-version", {
                            body: { proof_id: selected.id, target_version_id: versionId },
                          });
                          if (error || !data?.success) {
                            toast({ title: "Revert failed", description: data?.error || error?.message || "Failed", variant: "destructive" });
                          } else {
                            toast({ title: "Reverted", description: `Now showing v${data.active_version_number}` });
                            refreshSelected();
                          }
                        }}
                      />
                    )}
                  </div>

                  {/* Revisions — the team's read-only window into the customer's
                      "Revise with AI" chat (same data the customer sees). */}
                  <div id="revise-zone" className="scroll-mt-20 space-y-4">
                    <ProofRevisionThread
                      token={selected.view_token}
                      refreshKey={timelineRefreshKey}
                    />
                    {/* Customer ⇄ team messages — read here; AI-drafted replies
                        are approved from the email ("send as us"). */}
                    <TeamMessagesPanel
                      token={selected.view_token}
                      refreshKey={timelineRefreshKey}
                    />
                  </div>

                  {/* Emails sent to the customer — replays every email
                      that went out (subject + custom message + timestamp)
                      so the shop can see exactly what the client received. */}
                  <EmailsSentPanel
                    events={replyEvents}
                    customerEmail={selected.customer_email}
                  />

                  {/* Customer preview — embedded iframe of the public
                      /approve/:token page so the shop sees exactly what
                      the customer sees, with branding, without opening
                      a new tab. Drafts get a placeholder; once sent, the
                      live page renders inline. */}
                  <CustomerPreviewPanel
                    viewToken={selected.view_token}
                    status={selected.status}
                  />

                  {/* Project Timeline — audit trail */}
                  <ProofProjectTimeline
                    proofId={selected.id}
                    refreshKey={timelineRefreshKey}
                  />

                  {/* ── Customer replies — the two-way thread now lives in the
                      same tab as Send + Emails, so the whole conversation with
                      the customer is one place (ShopVox-style). ── */}
                  <div className="pt-3 mt-1 border-t border-gray-200 space-y-3">
                    <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-[#3b82f6]" />
                      Customer replies
                    </h3>
                      {/* See exactly what the customer sees — opens the full
                          branded proof page (the high-end approval system). */}
                      <button
                        type="button"
                        onClick={() => window.open(`/approve/${selected.view_token}`, "_blank")}
                        className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white h-10 text-sm font-semibold hover:brightness-110"
                      >
                        <Eye className="w-4 h-4" /> See the full proof the customer sees
                      </button>
                      <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
                        {replyEvents.filter((e) => e.event_type !== "email_sent").length === 0 ? (
                          <p className="text-sm text-gray-500 text-center py-6">No messages yet. Post the first one below.</p>
                        ) : (
                          replyEvents.filter((e) => e.event_type !== "email_sent").map((ev, i) => {
                            const isSystem = ev.actor_role === "system";
                            const isShop = ev.actor_role === "shop";
                            const outbound = isShop || isSystem;
                            const msg = threadEventMessage(ev);
                            return (
                              <div key={i} className={cn("rounded-md p-2.5 text-sm", outbound ? "bg-blue-50 border border-blue-200 ml-6" : "bg-zinc-50 border border-gray-200 mr-6")}>
                                <div className="flex items-center justify-between text-[10px] text-gray-900 mb-1">
                                  <span className="font-semibold">{isSystem ? "System" : isShop ? "You (shop)" : "Customer"}</span>
                                  <span title={new Date(ev.created_at).toISOString()}>{formatRelative(ev.created_at)}</span>
                                </div>
                                <p className="text-gray-800 whitespace-pre-wrap break-words">{msg}</p>
                                {typeof ev.payload?.html === "string" && ev.payload.html.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setEmailHtmlView(ev.payload.html)}
                                    className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:underline"
                                  >
                                    <Mail className="w-3 h-3" /> View exact email the customer got
                                  </button>
                                )}
                                {Array.isArray(ev.payload?.attachments) && ev.payload.attachments.length > 0 && (
                                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {ev.payload.attachments.map((a: any, ai: number) => (
                                      a?.url ? (
                                        <a key={ai} href={a.url} target="_blank" rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
                                          📎 {a.name || "attachment"}
                                        </a>
                                      ) : (
                                        <span key={ai} className="inline-flex items-center gap-1 text-[10px] text-gray-600 bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5">
                                          📎 {a.name || "attachment"}
                                        </span>
                                      )
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                      <div className="border-t border-gray-200 pt-3 space-y-2">
                        <Textarea
                          value={replyMessage}
                          onChange={(e) => setReplyMessage(e.target.value)}
                          placeholder={`Message to ${selected.customer_email || "the customer"}…`}
                          className="bg-white border-gray-200 text-gray-900 min-h-[80px]"
                        />
                        <div className="flex justify-between items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={draftingReply || sendingReply}
                            onClick={handleDraftReply}
                            className="border-gray-300 text-gray-700 hover:bg-gray-50"
                          >
                            {draftingReply ? (
                              <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Working…</>
                            ) : (
                              <><Sparkles className="h-3.5 w-3.5 mr-1.5" /> {replyMessage.trim() ? "Rewrite with AI" : "Draft with AI"}</>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            disabled={sendingReply || !replyMessage.trim()}
                            onClick={handleSendReply}
                            className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white border-0"
                          >
                            {sendingReply ? "Sending…" : "Send message"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>{/* /Source of Truth tab */}
                    </section>
                  </div>
                </div>
              </Card>
            )}
          </section>

          {/* RIGHT RAIL — proof views / contents (ProductionFlow 3-column) */}
          <aside className="hidden xl:block">
            {selected ? (
              <div className="sticky top-3">
                <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                  <div className="px-3 py-2 flex items-center gap-1.5 text-white text-[11px] font-bold uppercase tracking-wide" style={{ background: "linear-gradient(90deg,#3b82f6,#c026d3,#ec4899)" }}>
                    <ImageIcon className="w-3.5 h-3.5" /> Proof Views
                  </div>
                  <div className="p-3">
                  {(() => {
                    // Canonical view order — DRIVER SIDE first — with friendly labels.
                    const VIEW_ORDER = ["hero", "side", "driver-side", "passenger-side", "front", "rear", "roof", "hood_detail", "hood", "close-up"];
                    const VIEW_LABELS: Record<string, string> = {
                      hero: "Driver Side", side: "Driver Side", "driver-side": "Driver Side",
                      "passenger-side": "Passenger Side", front: "Front", rear: "Rear",
                      roof: "Roof", hood_detail: "Hood", hood: "Hood", "close-up": "Close-Up",
                    };
                    // Only REAL per-view renders we made — exclude weprintwraps.com URLs
                    // (customer example + stock thumb) and the 2D proof SHEET keys.
                    const SKIP = new Set(["production_proof", "proof_2d"]);
                    const raw = (Object.entries(activeVersion?.render_urls || {})
                      .filter(([k, u]) => !!u && !SKIP.has(k) && !String(u).includes("weprintwraps.com"))) as [string, string][];
                    // Sort to canonical order (driver side first), then dedupe identical
                    // URLs so a recreate's hero/side/passenger (same image) shows once.
                    raw.sort((a, b) => {
                      const ia = VIEW_ORDER.indexOf(a[0]); const ib = VIEW_ORDER.indexOf(b[0]);
                      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
                    });
                    const seen = new Set<string>();
                    const renders = raw
                      .filter(([, u]) => { if (seen.has(u)) return false; seen.add(u); return true; })
                      .map(([k, u]) => [VIEW_LABELS[k] || k.replace(/[_-]+/g, " "), u] as [string, string]);
                    const uploads = (activeVersion?.uploaded_file_paths || []).filter(Boolean).map((u, i) => [`Reference ${i + 1}`, u] as [string, string]);
                    const all = [...renders, ...uploads];
                    if (all.length === 0) return <p className="text-[11px] text-gray-400 italic">No proof yet — press GO and A.C.E creates the design (it recreates the customer's reference if they uploaded one).</p>;
                    // News-reel carousel — one view at a time, arrows to skim.
                    const idx = Math.min(proofRailIdx, all.length - 1);
                    const [curLabel, curUrl] = all[idx];
                    const go = (d: number) => setProofRailIdx((all.length + idx + d) % all.length);
                    return (
                      <div>
                        <div className="relative rounded-lg overflow-hidden border-2 border-[#0080dd]/30 bg-gray-100">
                          <img src={curUrl} alt={curLabel} className="w-full aspect-video object-cover cursor-zoom-in" onClick={() => setHeroOverrideUrl(curUrl)} loading="lazy" />
                          {all.length > 1 && (
                            <>
                              <button type="button" onClick={() => go(-1)} aria-label="Previous view" className="absolute left-1.5 top-1/2 -translate-y-1/2 z-20 p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white">
                                <ChevronLeft className="w-4 h-4" />
                              </button>
                              <button type="button" onClick={() => go(1)} aria-label="Next view" className="absolute right-1.5 top-1/2 -translate-y-1/2 z-20 p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white">
                                <ChevronRight className="w-4 h-4" />
                              </button>
                              <span className="absolute top-1.5 left-1/2 -translate-x-1/2 z-20 bg-black/60 text-white rounded-full px-2 py-0.5 text-[10px] font-semibold">{idx + 1}/{all.length}</span>
                            </>
                          )}
                          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
                            <span className="text-[11px] font-bold text-white capitalize">{curLabel}</span>
                          </div>
                        </div>
                        {all.length > 1 && (
                          <div className="flex items-center justify-center gap-1 mt-2 flex-wrap">
                            {all.map(([, u], i) => (
                              <button key={i} type="button" onClick={() => setProofRailIdx(i)} aria-label={`View ${i + 1}`}
                                className={cn("w-2 h-2 rounded-full transition-all", i === idx ? "bg-[#c026d3] scale-125" : "bg-gray-300 hover:bg-gray-400")} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  </div>
                </div>

                {/* 2D Proof + 3D Proof cards UNDER the Proof Views carousel. */}
                {(() => {
                  const ru = (activeVersion?.render_urls || {}) as Record<string, string>;
                  const p2d = ru.production_proof || ru.proof_2d || null;
                  const h3d = ru.hero || ru.side || null;
                  const has3d = ["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"].some((k) => ru[k]);
                  return (
                    <div className="mt-3 space-y-2">
                      <button type="button" onClick={() => setShow2DProofSheet(true)}
                        className="w-full rounded-xl border border-emerald-200 bg-white overflow-hidden text-left hover:border-emerald-400 transition">
                        <div className="px-3 py-1.5 text-white text-[10px] font-bold uppercase tracking-wider" style={{ background: "linear-gradient(90deg,#059669,#10b981)" }}>📄 2D Production Proof</div>
                        {p2d
                          ? <img src={p2d} alt="2D proof" className="w-full max-h-44 object-contain bg-white" loading="lazy" />
                          : <p className="text-[11px] text-gray-400 italic p-3">Not generated yet — click to build it.</p>}
                        <div className="px-3 py-1.5 text-[10px] font-semibold text-emerald-700">Dimensions + WePrintWraps info · open →</div>
                      </button>
                      <button type="button" onClick={() => setShow3DProofSheet(true)} disabled={!has3d}
                        className="w-full rounded-xl border border-violet-200 bg-white overflow-hidden text-left hover:border-violet-400 transition disabled:opacity-50">
                        <div className="px-3 py-1.5 text-white text-[10px] font-bold uppercase tracking-wider" style={{ background: "linear-gradient(90deg,#7c3aed,#a855f7)" }}>📄 3D Proof</div>
                        {has3d ? (() => {
                          // Preview the FULL multi-angle set as a shrunk contact-sheet
                          // grid, so the card reads as the single 3D-proof page it is —
                          // not a duplicate of the hero carousel above. De-duped.
                          const seen = new Set<string>();
                          const thumbs = ["side", "passenger-side", "front", "rear", "hood_detail", "close-up", "roof", "hero"]
                            .map((k) => ru[k])
                            .filter((u) => u && !seen.has(u) && (seen.add(u), true)) as string[];
                          return (
                            <div className="grid grid-cols-4 gap-px bg-zinc-900 p-1">
                              {thumbs.map((u, i) => (
                                <img key={i} src={u} alt="" loading="lazy" className="w-full aspect-video object-cover" />
                              ))}
                            </div>
                          );
                        })() : <p className="text-[11px] text-gray-400 italic p-3">No 3D yet.</p>}
                        <div className="px-3 py-1.5 text-[10px] font-semibold text-violet-700">Multi-angle gallery · open →</div>
                      </button>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-300 bg-white/50 p-4 text-center text-[11px] text-gray-400">
                Select an order to see its proof views.
              </div>
            )}
          </aside>
        </div>

        {/* Analytics — moved to the BOTTOM (work first, stats last). Drilling a
            card still filters the orders above + clears any open order. */}
        <ApproveProAnalyticsCards
          rows={rows as any}
          revenue={revenue}
          getOrderTotal={(r) => rowOrderTotal(r)}
          resolveAssignee={(id) => {
            const a: any = id ? team.lookup(id) : null;
            return a ? (a.name || a.label || a.fullName || (a.email ? String(a.email).split("@")[0] : null)) : null;
          }}
          onDrill={(key, label) => { setAnalyticsDrill({ key, label }); setSelectedId(null); }}
        />
      </main>

      {/* Send-proof composer — message + AI polish + choose what's on the portal. */}
      {selected && (() => {
        const ru = (activeVersion?.render_urls || {}) as Record<string, string>;
        const has2d = !!(ru.production_proof || ru.proof_2d);
        const has3d = ["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"].some((k) => ru[k]);
        const inc = (selected.metadata as any)?.portal_includes || null;
        return (
          <SendProofDialog
            open={sendProofOpen}
            onOpenChange={setSendProofOpen}
            proofId={selected.id}
            customerName={selected.customer_name}
            customerEmail={selected.customer_email}
            orderNumber={(selected.metadata as any)?.wpw_order_number || (selected.metadata as any)?.wpw_woo_order_id || null}
            vehicle={[selected.vehicle_year, selected.vehicle_make, selected.vehicle_model].filter(Boolean).join(" ") || null}
            has2d={has2d}
            has3d={has3d}
            views={(() => {
              const VL: Record<string, string> = { side: "Driver Side", "passenger-side": "Passenger Side", hood_detail: "Hood", front: "Front", rear: "Rear", "close-up": "Close-Up", roof: "Roof" };
              const order = ["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"];
              const r = (activeVersion?.render_urls || {}) as Record<string, string>;
              return order.filter((k) => r[k]).map((k) => ({ key: k, label: VL[k] || k, url: r[k] }));
            })()}
            proof2dUrl={(activeVersion?.render_urls as any)?.production_proof || (activeVersion?.render_urls as any)?.proof_2d || null}
            hero3dUrl={(activeVersion?.render_urls as any)?.hero || (activeVersion?.render_urls as any)?.side || null}
            colorways={allVersions.map((v) => {
              const t = String(v.prompt_text || "").toLowerCase();
              const ru = (v.render_urls || {}) as Record<string, string>;
              const thumb = ru.hero || ru.side || ru["passenger-side"] || ru.production_proof || null;
              const label = /\bwhite\b/.test(t) ? `⚪ White (v${v.version_number})` : /\bblack\b/.test(t) ? `⚫ Black (v${v.version_number})` : `v${v.version_number}`;
              return { id: v.id, label, thumb };
            }).filter((c) => c.thumb)}
            onSendColorways={async (ids) => {
              const chosen = allVersions.filter((v) => ids.includes(v.id));
              const panels = chosen.map((v) => {
                const t = String(v.prompt_text || "").toLowerCase();
                const ru: any = v.render_urls || {};
                const label = /\bwhite\b/.test(t) ? "WHITE VERSION" : /\bblack\b/.test(t) ? "BLACK VERSION" : `Version ${v.version_number}`;
                return { label, url: ru.hero || ru.side || ru["passenger-side"] || null };
              }).filter((p) => p.url);
              if (panels.length < 2) return;
              const genId = (selected as any).source_visualization_id || (selected.metadata as any)?.autogen_visualization_id || undefined;
              const resp = await fetch("https://www.restyleproai.com/api/compose-colorway-compare", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ generation_id: genId, panels }),
              });
              const j = await resp.json().catch(() => ({}));
              if (resp.ok && j?.url && activeVersion?.id) {
                const ru: Record<string, string> = { ...(activeVersion.render_urls || {}), colorway_compare: j.url };
                await supabase.from("proof_versions" as any).update({ render_urls: ru }).eq("id", activeVersion.id);
                setActiveVersion({ ...activeVersion, render_urls: ru } as ActiveVersion);
              }
            }}
            initialMessage={selected.message_to_customer || messageDraft || null}
            initialIncludes={inc}
            onSent={() => refreshSelected()}
          />
        );
      })()}

      {/* 2D PROOF viewer — the dimensioned production-proof SHEET (logo top
          corner + dimension arrows), the same TwoDProofSheet RevisionStudio
          renders. Re-composes from the views so it can't show a single side. */}
      <Dialog open={show2DProofSheet} onOpenChange={setShow2DProofSheet}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-auto p-0">
          {/* Prefer the STORED 2D proof (the one you uploaded/imported/generated)
              so this viewer reflects exactly what's on the version — it must NOT
              silently re-compose a fresh sheet from the (possibly wrong) views,
              which made a deleted proof appear to "come back". Only when there is
              no stored proof do we fall back to composing from the views. */}
          {selected && ((activeVersion?.render_urls as any)?.production_proof || (activeVersion?.render_urls as any)?.proof_2d) ? (
            <div className="bg-white p-2">
              <img
                src={(activeVersion?.render_urls as any)?.production_proof || (activeVersion?.render_urls as any)?.proof_2d}
                alt="2D production proof"
                className="w-full h-auto rounded"
              />
            </div>
          ) : selected && (
            <TwoDProofSheet
              views={(() => {
                const labels: Record<string, string> = { side: "Driver Side", "passenger-side": "Passenger Side", hood_detail: "Hood", front: "Front", rear: "Rear", roof: "Roof" };
                const order = ["side", "passenger-side", "hood_detail", "front", "rear", "roof"];
                const urls = (activeVersion?.render_urls || {}) as Record<string, string>;
                return order.filter((t) => urls[t]).map((t) => ({ type: t, url: urls[t], label: labels[t] || t }));
              })()}
              generationId={(selected as any).source_visualization_id || (selected.metadata as any)?.autogen_visualization_id || null}
              vehicleYear={String(selected.vehicle_year || "")}
              vehicleMake={selected.vehicle_make || ""}
              vehicleModel={selected.vehicle_model || ""}
              toolKey={"approvepro" as any}
              designName={(selected as any).design_name || (selected.metadata as any)?.design_name || undefined}
              finish={"Gloss"}
              onProofGenerated={(proofUrl) => {
                if (!activeVersion?.id) return;
                const ru: Record<string, string> = { ...(activeVersion.render_urls || {}), production_proof: proofUrl };
                supabase.from("proof_versions" as any).update({ render_urls: ru }).eq("id", activeVersion.id).then(() => {});
                setActiveVersion({ ...activeVersion, render_urls: ru } as ActiveVersion);
                setAllVersions((vs) => vs.map((v) => (v.id === activeVersion.id ? { ...v, render_urls: ru } : v)));
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* 3D PROOF viewer — the formatted multi-angle Design Approval gallery,
          the same ProfessionalProofSheet RevisionStudio opens. */}
      <Dialog open={show3DProofSheet} onOpenChange={setShow3DProofSheet}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-auto p-0">
          {selected && (
            <ProfessionalProofSheet
              views={(() => {
                const labels: Record<string, string> = { side: "Driver Side", "passenger-side": "Passenger Side", hood_detail: "Hood", front: "Front", rear: "Rear", "close-up": "Close-Up", roof: "Roof" };
                const order = ["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"];
                const urls = (activeVersion?.render_urls || {}) as Record<string, string>;
                return order.filter((t) => urls[t]).map((t) => ({ type: t, url: urls[t], label: labels[t] || t }));
              })()}
              vehicleYear={String(selected.vehicle_year || "")}
              vehicleMake={selected.vehicle_make || ""}
              vehicleModel={selected.vehicle_model || ""}
              toolKey={"approvepro" as any}
              designName={(selected as any).design_name || undefined}
              finish={"Gloss"}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Manual action preview/confirm — shows EXACTLY what will be sent (to
          whom, subject, what's in it) before it fires. */}
      {selected && (() => {
        const to = selected.customer_email || "the customer";
        const ACTIONS: Record<string, { title: string; icon: typeof Sparkles; tone: string; sends: boolean; subject?: string; body: string; run: () => void; cta: string }> = {
          request_info: {
            title: "Send missing-info instructions + portal link",
            icon: Sparkles, tone: "text-pink-600", sends: true,
            subject: "Quick details needed for your wrap design",
            body: `Emails ${to} a branded ApprovePro × WePrintWraps portal link asking them to type what they want and upload any logos / photos / inspiration. Their reply flows straight back into this order.`,
            run: () => handleSendPortalEmail("request"), cta: "Send invite",
          },
          go: {
            title: "Create the design in DesignPro (GO)",
            icon: Rocket, tone: "text-blue-600", sends: false,
            body: `A.C.E parses ALL of this order's info (order note + brief + uploaded art), then creates the design in DesignPro — recreating the customer's uploaded design if they sent one. Nothing is emailed to the customer; the proof stays a draft for you to review. If there's no usable info, A.C.E emails the portal invite instead.`,
            run: () => handleAgentGo(), cta: "Run A.C.E",
          },
          revision: {
            title: 'Trigger revision nudge',
            icon: RotateCw, tone: "text-fuchsia-600", sends: true,
            subject: "How can we get your design just right?",
            body: `Emails ${to} a friendly "how can we design it to your specs?" nudge to prompt a revision, with a link back to revise with AI and approve.`,
            run: () => handleManualFollowup("revised_not_approved", "Revision nudge"), cta: "Send nudge",
          },
          followup: {
            title: "Send best-fit follow-up (auto)",
            icon: Send, tone: "text-amber-600", sends: true,
            subject: "(auto-selected for this order's state)",
            body: `A.C.E picks the most relevant nudge for where this order is right now — no-response check-in, revision nudge, or brief reminder — and emails it to ${to}. Cadence-guarded so it never spams.`,
            run: () => handleManualFollowup(undefined, "Follow-up"), cta: "Send follow-up",
          },
          convert_3d: {
            title: '"See your 2D proof in 3D" upsell',
            icon: Sparkles, tone: "text-indigo-600", sends: true,
            subject: "Close more approvals — turn your design into a 3D render",
            body: `Emails ${to} the 3D-render upsell: add the photorealistic on-vehicle 3D render for $20, or go unlimited with RecreatePro X. Includes the portal link.`,
            run: () => handleManualFollowup("convert_3d", "3D render upsell"), cta: "Send upsell",
          },
        };
        const a = pendingAction ? ACTIONS[pendingAction] : null;
        const AIcon = a?.icon || Sparkles;
        return (
          <Dialog open={!!a} onOpenChange={(o) => { if (!o) setPendingAction(null); }}>
            <DialogContent className="bg-white max-w-md">
              {a && (
                <>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-gray-900">
                      <AIcon className={cn("w-5 h-5", a.tone)} /> {a.title}
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-2.5 text-sm">
                    {a.sends ? (
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-1.5">
                        <div className="flex gap-2"><span className="text-[11px] font-bold uppercase tracking-wide text-gray-400 w-14 shrink-0">To</span><span className="text-gray-900 font-medium break-all">{to}</span></div>
                        {a.subject && <div className="flex gap-2"><span className="text-[11px] font-bold uppercase tracking-wide text-gray-400 w-14 shrink-0">Subject</span><span className="text-gray-900">{a.subject}</span></div>}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[12px] font-semibold text-blue-800">
                        No email is sent to the customer — this runs A.C.E on the order.
                      </div>
                    )}
                    <p className="text-gray-700 leading-relaxed">{a.body}</p>
                  </div>
                  <DialogFooter className="gap-2 sm:gap-2">
                    <Button variant="outline" onClick={() => setPendingAction(null)} className="border-gray-300 text-gray-700">Cancel</Button>
                    <Button
                      onClick={() => { const run = a.run; setPendingAction(null); run(); }}
                      className="bg-gradient-to-r from-blue-600 to-fuchsia-600 text-white font-bold hover:opacity-90"
                    >
                      <AIcon className="w-4 h-4 mr-1.5" /> {a.cta}
                    </Button>
                  </DialogFooter>
                </>
              )}
            </DialogContent>
          </Dialog>
        );
      })()}

      {selected && (
        <EscalateSupportDialog
          open={showEscalate}
          onOpenChange={setShowEscalate}
          proofId={selected.id}
          onSuccess={() => {
            setShowEscalate(false);
            refreshSelected();
          }}
        />
      )}

      {selected && (
        <PullFromQCDialog
          open={showPullFromQC}
          onOpenChange={setShowPullFromQC}
          proofId={selected.id}
          onAttached={() => {
            loadList();
            regenVersionProof();
          }}
        />
      )}

      {selected && (
        <AttachDesignDialog
          proofId={selected.id}
          open={attachOpen}
          onOpenChange={setAttachOpen}
          onAttached={() => {
            loadList();
            regenVersionProof();
          }}
        />
      )}

      {/* IMPORT correct design from Revision Studio — paste a link / UUID and we
          set that design as this proof's active version. */}
      {selected && (
        <Dialog open={importOpen} onOpenChange={(v) => { if (!importing) setImportOpen(v); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Import design from Revision Studio</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-gray-600">
                Paste the Revision Studio link (or visualization ID) of the correct
                design. We'll set it as this proof's active version.
              </p>
              <Input
                value={importInput}
                onChange={(e) => setImportInput(e.target.value)}
                placeholder="/revision-studio?id=…  or visualization UUID"
                disabled={importing}
                onKeyDown={(e) => { if (e.key === "Enter" && importInput.trim() && !importing) importFromRevisionStudio(); }}
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={importFromRevisionStudio}
                  disabled={importing || !importInput.trim()}
                  className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white hover:brightness-110"
                >
                  {importing ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Importing…</> : <><Link2 className="h-4 w-4 mr-1.5" /> Import</>}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Exact-email viewer — the precise HTML the customer received. */}
      {emailHtmlView && (
        <div
          className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4"
          onClick={() => setEmailHtmlView(null)}
        >
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
              <span className="text-sm font-semibold text-gray-900">Exact email the customer received</span>
              <button type="button" onClick={() => setEmailHtmlView(null)} className="text-gray-500 hover:text-gray-900 text-sm font-semibold px-2">✕</button>
            </div>
            <iframe title="Exact email" sandbox="" srcDoc={emailHtmlView} className="w-full flex-1 min-h-[60vh] bg-white" />
          </div>
        </div>
      )}

      {/* New Proof Dialog — opens SendForApprovalDialog in upload mode */}
      <SendForApprovalDialog
        open={showNewProof}
        onOpenChange={(v) => {
          setShowNewProof(v);
          if (!v) loadList(); // Refresh list when dialog closes
        }}
        context={{
          renderUrls: {},
          defaultMode: "revision_loop",
        }}
      />

      {/* EMBEDDED REVISIONSTUDIO — the surgical AI editor, in place. Same-origin
          iframe = it inherits this logged-in session (no re-login). It edits the
          customer's CURRENT design and posts back when it saves a new version,
          which closes this overlay and refreshes the versions above. */}
      {editorUrl && (
        <div className="fixed inset-0 z-[120] bg-black/80 flex flex-col">
          <div
            className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2 bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white shrink-0"
            style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
          >
            <div className="flex items-center gap-2 text-xs sm:text-sm font-bold min-w-0">
              <Sparkles className="w-4 h-4 shrink-0" />
              <span className="truncate">
                <span className="hidden sm:inline">Editing </span>“{selected?.design_name || "design"}”<span className="hidden sm:inline"> — make your change, then “Save to this proof”</span>
              </span>
            </div>
            <button
              type="button"
              onClick={() => setEditorUrl(null)}
              className="shrink-0 rounded-md bg-white/20 hover:bg-white/30 px-3 py-1.5 text-sm font-semibold"
            >
              ✕ Close
            </button>
          </div>
          <iframe
            title="RevisionStudio editor"
            src={editorUrl}
            className="flex-1 w-full bg-black border-0"
            allow="clipboard-read; clipboard-write; microphone"
          />
        </div>
      )}

      {/* A.C.E AGENT — talk to it about the open order; it revises (surgically),
          sends, switches versions, or starts over. Hidden while the full-screen
          editor overlay is up so they don't fight for the corner. */}
      {selected && !editorUrl && (
        <ApproveProAgentChat
          proofId={selected.id}
          designName={selected.design_name}
          customerName={selected.customer_name}
          onActed={() => { refreshSelected(); }}
          openSignal={aceOpenSignal}
          seedInput={aceSeed}
        />
      )}
    </div>
  );
}

// ─── EmailsSentPanel ─────────────────────────────────────────────────────
// Replays every outbound email tied to a proof (initial send, resends,
// shop replies, send-failures). Reads `subject`, `message`, `to` from the
// proof_events.payload that proof-send / send-client-proof-email persist.

interface EmailsSentPanelProps {
  events: Array<{ event_type: string; actor_role: string; payload: any; created_at: string }>;
  customerEmail: string;
}

function EmailsSentPanel({ events, customerEmail }: EmailsSentPanelProps) {
  const [viewHtml, setViewHtml] = useState<string | null>(null);
  const emails = events.filter((ev) =>
    ev.event_type === "sent" ||
    ev.event_type === "resent" ||
    ev.event_type === "instructions_requested" ||
    ev.event_type === "shop_reply" ||
    ev.event_type === "send_failed" ||
    // Every other outbound proof email — shop notifications on approve/
    // decline/revision and the customer's new-version email — is logged
    // as a canonical "email_sent" event so the trail is complete.
    ev.event_type === "email_sent"
  );

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
        <Mail className="w-4 h-4 text-[#3b82f6]" />
        Emails sent
        <span className="text-[10px] text-gray-700 ml-auto">
          {emails.length} email{emails.length !== 1 ? "s" : ""}
        </span>
      </h3>
      {emails.length === 0 ? (
        <p className="text-xs text-gray-700 italic">
          No emails sent yet. Click <span className="font-semibold text-gray-600">Send Proof to Customer</span> above to email this design.
        </p>
      ) : (
        <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {emails.map((ev, i) => {
            const p = ev.payload || {};
            // Canonical "email_sent" events carry { direction, kind, delivered }.
            const isEmailSent = ev.event_type === "email_sent";
            const emailKind: string = isEmailSent ? (p.kind || "") : "";
            const toShop = isEmailSent && p.direction === "to_shop";
            // A logged email that failed to deliver (Resend rejected / no key).
            const isFailed = ev.event_type === "send_failed" || (isEmailSent && p.delivered === false);
            const isResend = ev.event_type === "resent" || emailKind === "resend";
            const isReply = ev.event_type === "shop_reply";
            const isInstr = ev.event_type === "instructions_requested";
            // Friendly subject fallback per email_sent kind.
            const kindSubject =
              emailKind === "outcome_approved" ? "Customer approved — your next step" :
              emailKind === "outcome_declined" ? "Customer declined this proof" :
              emailKind === "revision_requested" ? "Customer requested a revision" :
              emailKind === "new_version" ? "Updated design sent to customer" :
              emailKind === "initial_send" ? "Your design is ready for review" :
              null;
            const subject = p.subject
              || kindSubject
              || (isReply ? "Reply from your shop" : null)
              || (isInstr ? "Quick details needed for your wrap design" : null)
              || (isFailed ? "Delivery failed" : "Your design is ready for review");
            const exactHtml = typeof p.html === "string" ? p.html : null;
            const toAddr = p.to || p.sent_to || customerEmail;
            const body = p.message || p.body || null;
            const when = new Date(ev.created_at);
            // Direction label so the team can tell at a glance whether the
            // email went to the customer or to themselves (shop notification).
            const dirLabel = isEmailSent ? (toShop ? "→ Shop" : "→ Customer") : null;
            const kindBadge =
              emailKind === "outcome_approved" ? "Approved (shop alert)" :
              emailKind === "outcome_declined" ? "Declined (shop alert)" :
              emailKind === "revision_requested" ? "Revision (shop alert)" :
              emailKind === "new_version" ? "New version" :
              emailKind === "initial_send" ? "Initial send" :
              emailKind === "resend" ? "Resend" :
              null;
            const badgeText = isFailed ? "Failed" : kindBadge || (isReply ? "Shop reply" : isInstr ? "Instructions request" : isResend ? "Resend" : "Initial send");
            const badgeColor = isFailed
              ? "bg-red-50 border-red-200 text-red-700"
              : emailKind === "outcome_approved"
              ? "bg-green-50 border-green-200 text-green-700"
              : emailKind === "outcome_declined"
              ? "bg-red-50 border-red-200 text-red-700"
              : emailKind === "revision_requested" || isInstr
              ? "bg-purple-50 border-purple-200 text-purple-700"
              : emailKind === "new_version"
              ? "bg-cyan-50 border-cyan-200 text-cyan-700"
              : isReply
              ? "bg-blue-50 border-blue-200 text-blue-700"
              : isResend
              ? "bg-amber-50 border-amber-200 text-amber-800"
              : "bg-green-50 border-green-200 text-green-700";
            return (
              <li key={i} className="rounded-md border border-gray-200 bg-gray-50/50 p-3 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={cn("text-[9px] h-4 px-1.5", badgeColor)}>
                    {badgeText}
                  </Badge>
                  {dirLabel && (
                    <Badge variant="outline" className="text-[9px] h-4 px-1.5 bg-gray-50 border-gray-200 text-gray-600">
                      {dirLabel}
                    </Badge>
                  )}
                  <span className="text-[11px] text-gray-800 truncate flex-1 min-w-0">
                    To <span className="font-mono">{toAddr}</span>
                  </span>
                  <span className="text-[10px] text-gray-700 shrink-0" title={when.toISOString()}>
                    {when.toLocaleString("en-US", {
                      month: "short", day: "numeric", year: "numeric",
                      hour: "numeric", minute: "2-digit",
                    })}
                  </span>
                </div>
                <p className="text-[13px] font-semibold text-gray-900">{subject}</p>
                {body && (
                  <p className="text-[12px] text-gray-700 whitespace-pre-wrap leading-snug border-l-2 border-gray-200 pl-2">
                    {body}
                  </p>
                )}
                {isFailed && ev.payload?.error && (
                  <p className="text-[11px] text-red-700 font-mono">{String(ev.payload.error).slice(0, 200)}</p>
                )}
                <div className="flex items-center gap-3 flex-wrap">
                  {exactHtml && (
                    <button
                      type="button"
                      onClick={() => setViewHtml(exactHtml)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      <Mail className="w-3 h-3" />
                      View exact email
                    </button>
                  )}
                  {ev.payload?.view_url && !isFailed && !isReply && (
                    <a
                      href={ev.payload.view_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Open the link the customer received
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Exact-email viewer — renders the stored HTML the customer received in
          a sandboxed iframe (no scripts) so you see precisely what was sent. */}
      {viewHtml && (
        <div
          className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4"
          onClick={() => setViewHtml(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
              <span className="text-sm font-semibold text-gray-900">Exact email the customer received</span>
              <button
                type="button"
                onClick={() => setViewHtml(null)}
                className="text-gray-500 hover:text-gray-900 text-sm font-semibold px-2"
              >
                ✕
              </button>
            </div>
            <iframe
              title="Exact email"
              sandbox=""
              srcDoc={viewHtml}
              className="w-full flex-1 min-h-[60vh] bg-white"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CustomerPreviewPanel ───────────────────────────────────────────────
// Embedded iframe of the public /approve/:token page so the shop sees
// exactly what the customer sees (branding, layout, CTA) without leaving
// ApprovePro. Collapsible to save space.

interface CustomerPreviewPanelProps {
  viewToken: string;
  status: string;
}

function CustomerPreviewPanel({ viewToken, status }: CustomerPreviewPanelProps) {
  // Always-on so the design team can confirm the customer is seeing the right
  // art at any time. preview=1 renders the page read-only (no Approve/Decline),
  // so viewing here never acts as the customer.
  const [open, setOpen] = useState(true);
  const url = `/approve/${viewToken}?preview=1`;
  const isDraft = status === "draft";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Eye className="w-4 h-4 text-[#3b82f6]" />
        <h3 className="text-sm font-semibold text-gray-900">What the customer sees</h3>
        {isDraft && (
          <Badge variant="outline" className="text-[9px] h-4 px-1.5 bg-gray-100 text-gray-600 border-gray-200">
            Draft preview
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpen((o) => !o)}
            className="h-7 text-xs gap-1"
          >
            {open ? "Hide" : "Show inline"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
            className="h-7 text-xs gap-1"
          >
            <ExternalLink className="w-3 h-3" />
            Open in new tab
          </Button>
        </div>
      </div>
      {!open ? (
        <p className="text-xs text-gray-800">
          Live read‑only view of the customer's portal — exactly what they see (design, versions, branding). Read‑only here, so it's safe to compare anytime.
        </p>
      ) : (
        <div className="relative w-full overflow-hidden rounded-md border border-gray-200 bg-gray-50">
          <iframe
            src={url}
            title="Customer preview"
            className="w-full"
            style={{ height: 760 }}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          />
        </div>
      )}
    </div>
  );
}
