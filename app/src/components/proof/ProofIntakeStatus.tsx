/**
 * ProofIntakeStatus — the at-a-glance "do we have what we need to design this?"
 * banner at the top of the ApprovePro Work Order tab. It answers, in plain
 * language, the question a designer (or A.C.E) asks first:
 *
 *   • Do we have RELEVANT design instructions? (typed brief, uploaded art, or
 *     instructions A.C.E parsed out of the customer's email).
 *   • If they came from email — WHEN, and how many image examples were saved.
 *   • If we DON'T have them — say so clearly, show whether/when we emailed the
 *     customer the portal invite (with the link), and offer GO / resend.
 *
 * Data: proof.metadata (brief_source / brief_found_at / email_examples_found,
 * welcome_sent_at, instructions_requested_at) + the loaded proof_events
 * (instructions_requested, customer_reply). No fetching here.
 */

import { Sparkles, MailQuestion, MailCheck, CheckCircle2, ExternalLink, Send, Rocket, Loader2, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { classifyIntake } from "@/lib/approvepro-brief";

interface EventRow { event_type: string; actor_role: string; payload: any; created_at: string }

interface Props {
  proof: any;
  events: EventRow[];
  portalUrl: string;
  onResendInvite: () => void;
  onGo: () => void;
  busy?: boolean;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ProofIntakeStatus({ proof, events, portalUrl, onResendInvite, onGo, busy }: Props) {
  const md = proof?.metadata || {};
  const { hasBrief, hasArt, meaningfulText } = classifyIntake(md);

  const reqEvent = (events || []).find((e) => e.event_type === "instructions_requested");
  const replyEvent = (events || []).find((e) => e.event_type === "customer_reply");
  const requestedAt = md.instructions_requested_at || reqEvent?.created_at || null;
  const foundFromEmail = md.brief_source === "email";
  const foundAt = md.brief_found_at || replyEvent?.created_at || null;
  const examples = Number(md.email_examples_found) || 0;
  const welcomeAt = md.welcome_sent_at || null;

  // ── We HAVE what we need → green confirmation. ──
  if (hasBrief) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3">
        <div className="flex items-start gap-2.5">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-emerald-900">
              {foundFromEmail ? "Design instructions found in the customer's email" : "Design instructions on file — ready to design"}
            </p>
            <p className="text-[12px] text-emerald-800 mt-0.5 leading-snug">
              {foundFromEmail && foundAt && <>A.C.E parsed them from email on <strong>{fmtDate(foundAt)}</strong>{examples > 0 ? <> · <strong>{examples}</strong> image example{examples === 1 ? "" : "s"} saved to this order</> : null}. </>}
              {!foundFromEmail && (meaningfulText && hasArt
                ? "Typed brief + reference art attached."
                : meaningfulText ? "Typed design brief on file." : "Reference art attached — A.C.E will recreate it (RecreatePro).")}
            </p>
          </div>
          <Button size="sm" onClick={onGo} disabled={busy}
            title="Run A.C.E — create the design in DesignPro from these instructions"
            className="h-8 gap-1.5 bg-gradient-to-r from-blue-600 to-fuchsia-600 text-white hover:opacity-90 font-bold shrink-0">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />} GO
          </Button>
        </div>
      </div>
    );
  }

  // ── We DON'T have instructions → amber, with the email trail + actions. ──
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/70 p-3 space-y-2">
      <div className="flex items-start gap-2.5">
        <MailQuestion className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-amber-900">Customer provided no design instructions</p>
          <p className="text-[12px] text-amber-800 mt-0.5 leading-snug flex items-center gap-1">
            <Inbox className="w-3.5 h-3.5 shrink-0" />
            {replyEvent
              ? <>A.C.E searched the design inbox — found the customer's email{foundAt ? <> on <strong>{fmtDate(foundAt)}</strong></> : null}, but it had no usable brief.</>
              : <>A.C.E searched the design inbox — <strong>nothing found</strong> from this customer yet.</>}
          </p>
        </div>
      </div>

      {/* The portal-invite trail. */}
      <div className="rounded-md bg-white border border-amber-200 px-2.5 py-2 text-[12px] text-gray-700 space-y-1">
        {requestedAt ? (
          <div className="flex items-center gap-1.5">
            <MailCheck className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span>Requested instructions from <strong>{proof.customer_email}</strong> on <strong>{fmtDate(requestedAt)}</strong>.</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <MailQuestion className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span>No portal invite sent yet.</span>
          </div>
        )}
        {welcomeAt && (
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-blue-500 shrink-0" />
            <span>Welcome message sent on <strong>{fmtDate(welcomeAt)}</strong>.</span>
          </div>
        )}
        <a href={portalUrl} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-blue-600 hover:text-blue-800">
          <ExternalLink className="w-3.5 h-3.5" /> ApprovePro portal link
        </a>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onGo} disabled={busy}
          title="Run A.C.E — searches the inbox again, then emails the portal invite if still nothing"
          className="h-8 gap-1.5 bg-gradient-to-r from-blue-600 to-fuchsia-600 text-white hover:opacity-90 font-bold">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />} GO — request info
        </Button>
        <Button size="sm" variant="outline" onClick={onResendInvite} disabled={busy}
          title="Re-send the welcome + portal invite email now"
          className="h-8 gap-1.5 border-amber-300 text-amber-800 hover:bg-amber-100 font-semibold">
          <Send className="w-4 h-4" /> {requestedAt ? "Resend invite" : "Send welcome + portal invite"}
        </Button>
      </div>
    </div>
  );
}
