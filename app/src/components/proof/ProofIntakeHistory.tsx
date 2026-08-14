/**
 * ProofIntakeHistory — the inbound side of the Source of Truth: everything the
 * CUSTOMER sent us, in one place, with the art they attached shown as real
 * thumbnails. Answers "did a past email come in, and did it have art?".
 *
 * Sources (from proof_events):
 *   • customer_reply  (source=email)  — emails A.C.E parsed from the design
 *     inbox via intake-graph-poll; attachments = image URLs found.
 *   • customer_comment (source=portal_intake) — what the customer typed +
 *     uploaded in the ApprovePro portal intake form.
 *
 * Plus a top summary from proof.metadata (brief_source / brief_found_at /
 * email_examples_found) so the parse result is stated plainly even before you
 * scroll the list.
 */

import { Mail, Inbox, MessageSquarePlus, ImageOff, CheckCircle2 } from "lucide-react";

interface EventRow { event_type: string; actor_role: string; payload: any; created_at: string }

interface Props {
  proof: any;
  events: EventRow[];
}

function fmt(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

// Attachments can be plain URL strings (graph/portal) or { url, name } objects.
function attachmentUrls(payload: any): string[] {
  const a = payload?.attachments;
  if (!Array.isArray(a)) return [];
  return a.map((x: any) => (typeof x === "string" ? x : x?.url)).filter((u: any) => typeof u === "string" && u);
}

export function ProofIntakeHistory({ proof, events }: Props) {
  const md = proof?.metadata || {};
  const submissions = (events || []).filter(
    (e) => e.event_type === "customer_reply" || (e.event_type === "customer_comment" && e.actor_role === "customer"),
  );

  const totalArt = submissions.reduce((n, e) => n + attachmentUrls(e.payload).length, 0);
  const foundFromEmail = md.brief_source === "email";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
        <Inbox className="w-4 h-4 text-[#3b82f6]" />
        Customer submissions — emails &amp; portal
        <span className="text-[10px] text-gray-700 ml-auto">{submissions.length} message{submissions.length !== 1 ? "s" : ""} · {totalArt} art file{totalArt !== 1 ? "s" : ""}</span>
      </h3>

      {/* Parse summary — plain-language answer up top. */}
      <div className={`rounded-md px-3 py-2 text-[12px] flex items-start gap-2 ${foundFromEmail ? "bg-emerald-50 border border-emerald-200 text-emerald-900" : "bg-gray-50 border border-gray-200 text-gray-700"}`}>
        {foundFromEmail
          ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          : <ImageOff className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />}
        <span>
          {foundFromEmail
            ? <>Design instructions were <strong>parsed from the customer's email</strong>{md.brief_found_at ? <> on <strong>{fmt(md.brief_found_at)}</strong></> : null}{Number(md.email_examples_found) > 0 ? <> · <strong>{md.email_examples_found}</strong> example image{Number(md.email_examples_found) === 1 ? "" : "s"} saved</> : null}.</>
            : submissions.length > 0
              ? <>Customer sent {submissions.length} message{submissions.length !== 1 ? "s" : ""}{totalArt > 0 ? <> with <strong>{totalArt}</strong> art file{totalArt !== 1 ? "s" : ""}</> : " (no art attached)"}.</>
              : <>No customer emails or portal submissions found yet for this order.</>}
        </span>
      </div>

      {submissions.length > 0 && (
        <div className="space-y-2.5">
          {submissions.map((e, i) => {
            const isEmail = e.event_type === "customer_reply";
            const urls = attachmentUrls(e.payload);
            const subject = e.payload?.subject;
            const message = e.payload?.message || (urls.length ? "(images only)" : "");
            const from = e.payload?.from || proof.customer_email;
            return (
              <div key={i} className="rounded-md border border-gray-200 bg-gray-50/60 p-2.5">
                <div className="flex items-center gap-1.5 text-[11px] text-gray-600 mb-1">
                  {isEmail ? <Mail className="w-3.5 h-3.5 text-blue-500" /> : <MessageSquarePlus className="w-3.5 h-3.5 text-fuchsia-500" />}
                  <span className="font-semibold text-gray-800">{isEmail ? "Email" : "Portal submission"}</span>
                  {isEmail && from ? <span className="truncate">· {from}</span> : null}
                  <span className="ml-auto shrink-0">{fmt(e.created_at)}</span>
                </div>
                {subject && <p className="text-[12px] font-semibold text-gray-900 mb-0.5">{subject}</p>}
                {message && <p className="text-[12px] text-gray-800 whitespace-pre-wrap break-words leading-snug">{message}</p>}
                {urls.length > 0 && (
                  <div className="mt-2">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 mb-1">Art found ({urls.length})</p>
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                      {urls.map((u, ui) => (
                        <a key={ui} href={u} target="_blank" rel="noreferrer" title="Open full size"
                          className="block rounded border border-gray-200 overflow-hidden hover:border-blue-400 transition-colors">
                          <img src={u} alt={`Art ${ui + 1}`} loading="lazy" className="w-full aspect-square object-cover bg-white" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
