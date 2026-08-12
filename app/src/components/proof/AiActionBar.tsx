/**
 * AiActionBar — the AI-first control strip at the top of the ApprovePro work
 * area, styled in the ProductionFlow visual language (clean white surface,
 * status chips, a blue→magenta gradient primary action top-right).
 *
 * It reads the proof's state and tells the team, at a glance:
 *   • what Ace (the AI) already did  — auto-designed, current version, revisions
 *   • the single recommended NEXT action — one click to run it
 *   • a manual fallback right beside it (AI first, designer second)
 *
 * The team always keeps full manual control via the sections below; this bar
 * just removes the "what do I do next?" guesswork and makes the AI path the
 * obvious one.
 */

import { Button } from "@/components/ui/button";
import {
  Sparkles, Send, Loader2, Bell, RefreshCw, CheckCircle2, Bot, Wand2, Upload as UploadIcon,
} from "lucide-react";

type Recommendation = {
  key: "generate" | "designing" | "send" | "nudge" | "revise" | "approved" | "none";
  label: string;
  sub: string;
  icon: typeof Sparkles;
  run?: () => void;
  disabled?: boolean;
  tone: "ai" | "send" | "wait" | "revise" | "done";
};

interface Props {
  orderLabel: string;
  status: string;
  hasDesign: boolean;
  autogenStatus?: string | null;       // "running" | "done" | "failed" | "needs_brief" | null
  autogenError?: string | null;        // failure reason, surfaced when failed
  versionNumber?: number | null;
  aiRevisions?: { used: number; allowed: number; remaining: number } | null;
  busy?: string | null;                // current busyAction key, if any
  hasBrief?: boolean;                  // did the customer send a brief / examples?
  onGo: () => void;                    // GO — run the A.C.E agent (design or request info)
  onGenerate?: () => void;
  onSend: () => void;
  onNudge: () => void;
  onRevise: () => void;
  // Customer order context, surfaced right in the banner.
  customerName?: string;
  vehicleName?: string;
  instructions?: string;
  uploads?: string[];                  // customer's uploaded reference/example images
  placedAt?: string;                   // date the order was placed
}

function chip(text: string, cls: string) {
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>{text}</span>;
}

export function AiActionBar(props: Props) {
  const { status, hasDesign, autogenStatus, versionNumber, aiRevisions, busy, hasBrief } = props;
  const s = (status || "").toLowerCase();
  const isBusy = !!busy;

  let rec: Recommendation;
  if (!hasDesign && autogenStatus === "running") {
    rec = { key: "designing", label: "A.C.E is designing…", sub: "The AI Creative Engine is generating the first concept from the brief.", icon: Bot, disabled: true, tone: "ai" };
  } else if (!hasDesign && !hasBrief) {
    rec = { key: "go_request", label: "GO — request info", sub: "No brief yet. Press GO and A.C.E emails the customer a portal link to add their design details + examples.", icon: Send, run: props.onGo, tone: "wait" };
  } else if (!hasDesign) {
    rec = { key: "go_design", label: "GO — create in DesignPro", sub: "Press GO: A.C.E parses the brief + references and creates the design in DesignPro. You review before it sends.", icon: Wand2, run: props.onGo, tone: "ai" };
  } else if (s === "revising") {
    rec = { key: "revise", label: "Revise the design", sub: "The customer asked for changes — see their request below, then push a new version.", icon: RefreshCw, run: props.onRevise, tone: "revise" };
  } else if (s === "declined") {
    rec = { key: "revise", label: "Revise & resend", sub: "The customer declined — read why below, revise, and send again.", icon: RefreshCw, run: props.onRevise, tone: "revise" };
  } else if (s === "draft") {
    rec = { key: "send", label: "Send proof to customer", sub: "Design is ready — send the branded approval link by email.", icon: Send, run: props.onSend, tone: "send" };
  } else if (s === "approved") {
    rec = { key: "approved", label: "Approved — move to production", sub: "The customer signed off. Order the production pack / printed wrap.", icon: CheckCircle2, disabled: true, tone: "done" };
  } else if (["sent", "viewed", "delivered", "delivery_failed", "escalated_support"].includes(s)) {
    rec = { key: "nudge", label: "Nudge the customer", sub: "Waiting on the customer — text them the link so they can approve from their phone.", icon: Bell, run: props.onNudge, tone: "wait" };
  } else {
    rec = { key: "none", label: "No action needed", sub: "", icon: CheckCircle2, disabled: true, tone: "done" };
  }

  const Icon = rec.icon;
  // ProductionFlow blue gradient header band; the primary action is a solid
  // white button with tone-colored text so it pops against the blue.
  const toneText =
    rec.tone === "ai" ? "text-blue-700"
    : rec.tone === "send" ? "text-indigo-700"
    : rec.tone === "revise" ? "text-fuchsia-700"
    : rec.tone === "wait" ? "text-amber-700"
    : "text-gray-500";

  const showManual = rec.key === "go_design" || rec.key === "revise";

  return (
    <div
      className="px-3 py-1.5 text-white border-b border-blue-900/10"
      style={{ background: "linear-gradient(135deg,#0066cc,#00a8e8,#0080dd)" }}
    >
      <div className="flex items-center gap-2.5">
        {/* A.C.E avatar — compact (thin banner) */}
        <img src="/characters/ace-desk-branded.png" alt="A.C.E" className="w-8 h-8 rounded-lg object-contain bg-white/20 ring-1 ring-white/25 p-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap">
            <span className="text-[14px] font-extrabold leading-none tracking-tight">A.C.E</span>
            <span className="hidden md:inline text-[11px] font-semibold text-white/80 leading-none">AI Creative Engine · DesignPro™</span>
            <span className="text-[11px] text-white/80 leading-none">{props.orderLabel}</span>
            {autogenStatus === "done" && chip("AI-designed", "bg-white/20 text-white")}
            {autogenStatus === "running" && chip("designing…", "bg-white/20 text-white")}
            {autogenStatus === "failed" && chip("design failed", "bg-red-500/90 text-white")}
            {autogenStatus === "needs_brief" && chip("awaiting brief", "bg-amber-300 text-amber-900")}
            {hasDesign && versionNumber ? chip(`v${versionNumber}`, "bg-white/20 text-white") : null}
            {aiRevisions && aiRevisions.used > 0 ? chip(`${aiRevisions.used} rev`, "bg-white/20 text-white") : null}
            {!hasDesign && autogenStatus !== "running" ? chip("no design", "bg-amber-300 text-amber-900") : null}
          </div>
          {/* A.C.E's recommendation — kept on a single tight line so the banner
              stays thin. Truncates; full text in the button tooltip. */}
          {rec.sub && <p className="text-[11px] text-white/85 leading-tight mt-0.5 truncate">{rec.sub}</p>}
        </div>

        {/* Recommended action — right. Manual fallback inline. */}
        <div className="flex items-center gap-1.5 shrink-0">
          {showManual && (
            <button
              type="button"
              onClick={props.onRevise}
              disabled={isBusy}
              title="Upload artwork yourself"
              className="hidden sm:inline-flex items-center gap-1 h-8 px-2.5 rounded-lg bg-white/15 hover:bg-white/25 ring-1 ring-white/20 text-[12px] font-semibold transition"
            >
              <UploadIcon className="w-3.5 h-3.5" /> Manual
            </button>
          )}
          <Button
            onClick={rec.run}
            disabled={rec.disabled || isBusy || !rec.run}
            title={rec.sub}
            className={`h-8 px-3.5 text-[13px] bg-white hover:bg-white hover:brightness-95 font-bold border-0 shadow-sm ${toneText}`}
          >
            {isBusy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Icon className="w-3.5 h-3.5 mr-1" />}
            {rec.label}
          </Button>
        </div>
      </div>

      {/* Surface a failed background auto-design with its reason, so a stalled
          design is never silent. Retry is the GO action above. */}
      {autogenStatus === "failed" && props.autogenError && (
        <p className="text-[12.5px] text-white bg-red-600/40 ring-1 ring-red-200/40 rounded-md px-2.5 py-1.5 mt-2 max-w-4xl">
          <span className="font-semibold">Auto-design failed:</span> {props.autogenError} — press <span className="font-semibold">GO</span> to retry, or use Manual upload.
        </p>
      )}
    </div>
  );
}
