/**
 * SendProofDialog — the send-time control the team gets when they click
 * "Send Proof to Customer". Instead of firing the email blind, it lets them:
 *   • type / edit the message the customer sees in the email + portal,
 *   • click "✨ Make it sound better" to have AI (draft-reply) rewrite it,
 *   • CHOOSE what the customer sees on the portal (2D proof / 3D proof) — the
 *     flat master artboard is ALWAYS hidden (DesignProAI property).
 *
 * The portal selection is persisted to proof_approvals.metadata.portal_includes,
 * which the customer portal (Proof.tsx) reads to show/hide the proof buttons.
 */

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Send, Sparkles, FileText } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  proofId: string;
  customerName?: string | null;
  customerEmail?: string | null;
  orderNumber?: string | null;
  vehicle?: string | null;
  /** is a dimensioned 2D production proof available to show? */
  has2d: boolean;
  /** are 3D angle views available to show? */
  has3d: boolean;
  /** the individual 3D angle views, so the team can pick which ones to send
   *  (e.g. drop a bad "front" render that came out as a side). */
  views?: { key: string; label: string; url: string }[];
  /** thumbnail of the 2D production-proof sheet, so the team sees what they send. */
  proof2dUrl?: string | null;
  /** thumbnail of the hero render for the 3D proof preview. */
  hero3dUrl?: string | null;
  /** saved colorway versions (e.g. White / Black) the team can pick to send. */
  colorways?: { id: string; label: string; thumb: string | null }[];
  /** combine the picked colorway version ids into ONE comparison the customer
   *  sees, persist it, and resolve when done. Provided by the parent. */
  onSendColorways?: (versionIds: string[]) => Promise<void>;
  /** current saved message, prefilled into the box */
  initialMessage?: string | null;
  /** previously-chosen portal includes, if any */
  initialIncludes?: { twoD?: boolean; threeD?: boolean; views?: string[] } | null;
  onSent?: () => void;
}

export function SendProofDialog(props: Props) {
  const { toast } = useToast();
  const allViews = props.views || [];
  const [message, setMessage] = useState("");
  const [twoD, setTwoD] = useState(true);
  const [threeD, setThreeD] = useState(true);
  const [pickViews, setPickViews] = useState<Set<string>>(new Set());
  const allColorways = props.colorways || [];
  const [pickCW, setPickCW] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [polishing, setPolishing] = useState(false);

  // Re-seed each time the dialog opens for a (possibly different) order.
  useEffect(() => {
    if (!props.open) return;
    setMessage(props.initialMessage || "");
    setTwoD(props.initialIncludes?.twoD ?? props.has2d);
    setThreeD(props.initialIncludes?.threeD ?? props.has3d);
    const prev = props.initialIncludes?.views;
    setPickViews(new Set(Array.isArray(prev) && prev.length ? prev : allViews.map((v) => v.key)));
    setPickCW(new Set());
  }, [props.open]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCW = (id: string) => setPickCW((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const toggleView = (k: string) => setPickViews((s) => {
    const n = new Set(s);
    n.has(k) ? n.delete(k) : n.add(k);
    return n;
  });

  const polish = async () => {
    if (!message.trim()) {
      toast({ title: "Type a message first", description: "Add a rough note and A.C.E will polish it." });
      return;
    }
    setPolishing(true);
    try {
      const { data, error } = await supabase.functions.invoke("draft-reply", {
        body: {
          draft: message,
          customerName: props.customerName || undefined,
          orderNumber: props.orderNumber || undefined,
          vehicle: props.vehicle || undefined,
        },
      });
      const rewritten = (data as any)?.draft;
      if (error || !rewritten) {
        toast({ title: "Couldn't rewrite", description: (data as any)?.error || error?.message || "Try again", variant: "destructive" });
        return;
      }
      setMessage(rewritten);
    } finally {
      setPolishing(false);
    }
  };

  // RESILIENT FALLBACK — proof-send 401s when the logged-in token is stale, which
  // silently kills the send. This path uses send-client-proof-email (Resend, no
  // user-auth gate) which ALSO records the send on the proof server-side (status
  // → sent, sent_at, message_to_customer, and a 'sent' event with the message +
  // the design thumbnails) so the admin activity + customer portal both show it.
  const sendViaResendFallback = async (): Promise<boolean> => {
    try {
      const { data: row } = await supabase.from("proof_approvals" as any)
        .select("view_token").eq("id", props.proofId).maybeSingle();
      const token = (row as any)?.view_token;
      const portalUrl = token ? `https://designproai.com/approve/${token}` : undefined;
      const views: { type: string; url: string; label?: string }[] = [];
      if (threeD && props.hero3dUrl) views.push({ type: "hero", url: props.hero3dUrl, label: "Design" });
      allViews.filter((v) => pickViews.has(v.key)).forEach((v) => views.push({ type: v.key, url: v.url, label: v.label }));
      if (twoD && props.proof2dUrl) views.push({ type: "proof", url: props.proof2dUrl, label: "2D Production Proof" });
      const { data, error } = await supabase.functions.invoke("send-client-proof-email", {
        body: {
          to: props.customerEmail,
          clientName: props.customerName || (props.customerEmail || "there").split("@")[0],
          subject: `Your ${props.vehicle || "vehicle"} wrap design is ready`,
          body: message || "Your custom wrap design is ready for review!",
          emailType: "proof",
          vehicleInfo: {},
          views,
          portalUrl,
          proof_id: props.proofId,
          markSent: true,
        },
      });
      return !(error || !(data as any)?.success);
    } catch {
      return false;
    }
  };

  const send = async () => {
    setBusy(true);
    try {
      // 1) Persist the message + portal visibility selection on the proof so the
      //    customer portal honors it and the next send reuses it.
      const { data: row } = await supabase.from("proof_approvals" as any)
        .select("metadata").eq("id", props.proofId).maybeSingle();
      const md = ((row as any)?.metadata as any) || {};
      await supabase.from("proof_approvals" as any).update({
        message_to_customer: message || null,
        metadata: { ...md, portal_includes: { twoD, threeD, views: Array.from(pickViews) } },
      }).eq("id", props.proofId);

      // 1b) If the team picked colorways (e.g. White + Black), combine them into
      //     ONE comparison the customer sees on the portal.
      if (pickCW.size >= 2 && props.onSendColorways) {
        try { await props.onSendColorways(Array.from(pickCW)); }
        catch { toast({ title: "Colorway combine failed", description: "Sent the proof without the combined colorways.", variant: "destructive" }); }
      }

      // 2) Fire the proof email with the custom message.
      const { data, error } = await supabase.functions.invoke("proof-send", {
        body: { proof_id: props.proofId, force: true, custom_message: message || undefined },
      });
      if (error || !(data as any)?.success) {
        // proof-send failed (commonly a 401 "Invalid auth token" on a stale
        // session). Don't drop the send — fall back to the Resend path, which
        // also records it on the proof.
        const okFb = await sendViaResendFallback();
        if (!okFb) {
          toast({ title: "Send failed", description: (data as any)?.error || error?.message || "Failed", variant: "destructive" });
          return;
        }
        toast({ title: "Proof sent", description: `Email on its way to ${props.customerEmail || "the customer"} (via backup sender).` });
        props.onSent?.();
        props.onOpenChange(false);
        return;
      }
      toast({ title: "Proof sent", description: `Email on its way to ${props.customerEmail || "the customer"}.` });
      props.onSent?.();
      props.onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl bg-white max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-gray-900">Send proof to {props.customerName || "customer"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Message — bordered card so the text box stands out on the dialog. */}
          <div className="rounded-md border border-gray-200 bg-white p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-gray-700">Message to the customer</label>
              <Button onClick={polish} disabled={polishing || busy} size="sm" variant="outline"
                className="h-7 text-xs gap-1 border-blue-300 text-blue-700 hover:bg-blue-50">
                {polishing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                Make it sound better
              </Button>
            </div>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="e.g. Hi! Here's your wrap design — let me know if any tweaks are needed before we go to print. Thanks!"
              rows={4}
              disabled={busy}
              className="text-sm bg-white text-gray-900 border-2 border-gray-300 focus-visible:border-blue-400 focus-visible:ring-blue-200"
            />
            <p className="text-[10px] text-gray-400">Shown above the Approve / Decline buttons in the email + portal.</p>
          </div>

          {/* Add designs to the portal — or leave all unchecked to send a
              message-only email. */}
          <div className="rounded-md border border-gray-200 p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-700 flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Add designs to the portal <span className="font-normal text-gray-400">(or leave unchecked for a message-only email)</span></p>
            <label className={`flex items-center gap-2 text-sm ${props.has2d ? "text-gray-900" : "text-gray-400"}`}>
              <Checkbox checked={twoD} onCheckedChange={(v) => setTwoD(!!v)} disabled={!props.has2d || busy} />
              {props.proof2dUrl && <img src={props.proof2dUrl} alt="2D proof" className="w-12 h-9 object-cover rounded border border-gray-200" loading="lazy" />}
              2D Production Proof {props.has2d ? "" : "(not generated yet)"}
            </label>
            <label className={`flex items-center gap-2 text-sm ${props.has3d ? "text-gray-900" : "text-gray-400"}`}>
              <Checkbox checked={threeD} onCheckedChange={(v) => setThreeD(!!v)} disabled={!props.has3d || busy} />
              {props.hero3dUrl && <img src={props.hero3dUrl} alt="3D proof" className="w-12 h-9 object-cover rounded border border-gray-200" loading="lazy" />}
              3D Proof (multi-angle) {props.has3d ? "" : "(not generated yet)"}
            </label>

            {/* Per-angle picker — uncheck any bad render (e.g. a "front" that
                came out as a side) so the customer never sees it. */}
            {threeD && allViews.length > 0 && (
              <div className="mt-1.5 pl-1 border-l-2 border-gray-100">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5 pl-1.5">Choose angles to include</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pl-1.5">
                  {allViews.map((v) => (
                    <label key={v.key} className={`flex items-center gap-1.5 text-[12px] rounded border p-2 cursor-pointer min-h-[3.25rem] ${pickViews.has(v.key) ? "border-blue-300 bg-blue-50/40 text-gray-900" : "border-gray-200 text-gray-400"}`}>
                      <Checkbox checked={pickViews.has(v.key)} onCheckedChange={() => toggleView(v.key)} disabled={busy} />
                      <img src={v.url} alt={v.label} className="w-16 h-12 object-cover rounded shrink-0" loading="lazy" />
                      <span className="truncate">{v.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <p className="text-[10px] text-gray-400">The flat master artboard is always hidden from the customer.</p>
          </div>

          {/* Colorways — pick the saved versions (e.g. White + Black) to send.
              Tick two and the customer sees them side-by-side on his portal. */}
          {allColorways.length >= 2 && (
            <div className="rounded-md border border-gray-200 p-3 space-y-2">
              <p className="text-xs font-semibold text-gray-700 flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Send colorways <span className="font-normal text-gray-400">(tick 2+ to send them together — e.g. White + Black)</span></p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {allColorways.map((c) => (
                  <label key={c.id} className={`flex items-center gap-1.5 text-[12px] rounded border p-2 cursor-pointer min-h-[3.25rem] ${pickCW.has(c.id) ? "border-fuchsia-300 bg-fuchsia-50/40 text-gray-900" : "border-gray-200 text-gray-500"}`}>
                    <Checkbox checked={pickCW.has(c.id)} onCheckedChange={() => toggleCW(c.id)} disabled={busy} />
                    {c.thumb && <img src={c.thumb} alt={c.label} className="w-16 h-12 object-cover rounded shrink-0" loading="lazy" />}
                    <span className="truncate font-semibold">{c.label}</span>
                  </label>
                ))}
              </div>
              {pickCW.size === 1 && <p className="text-[10px] text-amber-600">Tick one more to send a colorway comparison.</p>}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)} disabled={busy} className="text-gray-700">Cancel</Button>
          <Button onClick={send} disabled={busy} className="gap-1.5 text-white" style={{ background: "linear-gradient(90deg,#3b82f6,#ec4899)" }}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send proof
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
