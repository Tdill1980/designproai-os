/**
 * EscalateSupportDialog
 *
 * Shop-owner triggered dialog for Tier-3 RestylePro Support escalation
 * (Phase 5). Collects an optional reason and calls proof-escalate-support.
 * The edge function snapshots the proof + versions + events, posts to Slack
 * (if SLACK_WEBHOOK_URL_PROOF_SUPPORT is set), and flips proof.status →
 * escalated_support.
 */

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, LifeBuoy } from "lucide-react";
import { ApproveProBrand } from "@/components/proof/ApproveProBrand";

interface EscalateSupportDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Shop path */
  proofId?: string;
  /** Customer path (if ever enabled on the public page) */
  token?: string;
  onSuccess: (escalationId: string) => void;
}

export const EscalateSupportDialog = ({
  open,
  onOpenChange,
  proofId,
  token,
  onSuccess,
}: EscalateSupportDialogProps) => {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    if (isSubmitting) return;
    setReason("");
    setError(null);
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!proofId && !token) {
      setError("Missing proof context.");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        reason: reason.trim() || undefined,
      };
      if (proofId) body.proof_id = proofId;
      if (token) body.token = token;

      const { data, error: invokeErr } = await supabase.functions.invoke(
        "proof-escalate-support",
        { body },
      );
      if (invokeErr || !data?.success) {
        const msg = (data as any)?.error || invokeErr?.message || "Escalation failed";
        setError(msg);
        setIsSubmitting(false);
        return;
      }
      toast({
        title: data.already_escalated ? "Already escalated" : "Escalated to RestylePro Support",
        description: data.already_escalated
          ? "The RestylePro team is already on it."
          : "Lance + the team have been notified. Expect a response shortly.",
      });
      onSuccess(data.escalation_id);
      setReason("");
    } catch (err: any) {
      setError(err?.message || "Network error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(v) : handleClose())}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <ApproveProBrand subtitle="Escalate to RestylePro Support" />
        <div className="px-6 pt-4 pb-4 space-y-3">
        <DialogTitle className="flex items-center gap-2">
          <LifeBuoy className="w-4 h-4 text-amber-600" />
          Escalate to RestylePro Support
        </DialogTitle>
        <DialogDescription>
          Loop in Lance + the RestylePro team for deep iteration on this
          design. They'll get the full session context — all versions, all
          notes — and can work directly on the proof.
        </DialogDescription>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="escalate-reason" className="text-sm">
              What do you need help with? <span className="text-xs text-zinc-500">(optional)</span>
            </Label>
            <Textarea
              id="escalate-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer wants a photorealistic carbon wrap with their business logo integrated. Tried 3 revisions, can't nail it."
              className="min-h-[100px]"
              maxLength={5000}
              disabled={isSubmitting}
            />
          </div>

          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-sm p-3">
              {error}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 mt-2">
          <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {isSubmitting ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Escalating…</>
            ) : (
              <><LifeBuoy className="w-4 h-4 mr-2" /> Send to RestylePro</>
            )}
          </Button>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
