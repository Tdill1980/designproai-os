/**
 * WpwOrderProofActions — assignment + workbench bridge for a WPW order.
 *
 * Rendered inside WpwOrderDetailModal when ApprovePro opens an order so a
 * designer can claim / assign the job (and jump to the approval workbench
 * to send the proof) without leaving the order view.
 *
 * Assignment lives on proof_approvals, so we first look for an existing
 * proof linked to this Woo order (metadata.wpw_woo_order_id). If none
 * exists yet, "Claim this job" creates one on the fly via
 * approvepro-sync-wpw single-order mode, then assigns it to the caller.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { AssignProofControl } from "./AssignProofControl";
import { useShopTeam } from "@/hooks/useShopTeam";
import { useToast } from "@/hooks/use-toast";
import { Loader2, UserCheck, ArrowRight, FileText, Sparkles } from "lucide-react";

interface WpwOrderProofActionsProps {
  wooOrderId: number;
  /** Select this proof in the workbench (and close the modal). */
  onOpenWorkbench?: (proofId: string) => void;
}

export const WpwOrderProofActions = ({
  wooOrderId,
  onOpenWorkbench,
}: WpwOrderProofActionsProps) => {
  const { currentUserId } = useShopTeam();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [proofId, setProofId] = useState<string | null>(null);
  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("proof_approvals" as any)
        .select("id, assigned_to")
        .eq("metadata->>wpw_woo_order_id", String(wooOrderId))
        .order("updated_at", { ascending: false })
        .limit(1);
      if (cancelled) return;
      const row = (data as any[] | null)?.[0];
      setProofId(row?.id ?? null);
      setAssignedTo(row?.assigned_to ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [wooOrderId]);

  // Find-or-create the proof for this Woo order. Returns its id.
  const ensureProof = async (): Promise<string | null> => {
    if (proofId) return proofId;
    const { data, error } = await supabase.functions.invoke("approvepro-sync-wpw", {
      body: { woo_order_id: wooOrderId },
    });
    const id = (data as { proof_id?: string | null } | null)?.proof_id ?? null;
    if (error || !id) {
      toast({
        title: "Couldn't set up this job",
        description: error?.message || "Try again in a moment.",
        variant: "destructive",
      });
      return null;
    }
    setProofId(id);
    return id;
  };

  const claim = async () => {
    setBusy(true);
    try {
      const id = await ensureProof();
      if (!id || !currentUserId) return;
      const { error } = await (supabase as any).rpc("proof_assign", {
        _proof_id: id,
        _assignee: currentUserId,
      });
      if (error) throw error;
      setAssignedTo(currentUserId);
      toast({ title: "Claimed", description: "You're now the designer on this job." });
    } catch (err: any) {
      toast({ title: "Assign failed", description: err?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const openWorkbench = async () => {
    setBusy(true);
    try {
      const id = await ensureProof();
      if (id) onOpenWorkbench?.(id);
    } finally {
      setBusy(false);
    }
  };

  // Open the WPW proof-approval sheet builder for this job.
  const openProofSheet = async () => {
    setBusy(true);
    try {
      const id = await ensureProof();
      if (id) navigate(`/wpw-proof/${id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 space-y-3">
      <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] text-blue-700">
        Design assignment
      </h4>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Checking assignment…
        </div>
      ) : proofId ? (
        <AssignProofControl
          proofId={proofId}
          assignedTo={assignedTo}
          onChange={setAssignedTo}
        />
      ) : (
        <Button
          size="sm"
          type="button"
          onClick={claim}
          disabled={busy}
          className="gap-1 bg-blue-600 hover:bg-blue-700 text-white border-0 rounded-xl"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
          Claim this job
        </Button>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          type="button"
          variant="outline"
          onClick={openWorkbench}
          disabled={busy}
          className="gap-1 border-gray-300 text-gray-700 hover:bg-white rounded-xl"
        >
          Open in approval workbench
          <ArrowRight className="w-3.5 h-3.5" />
        </Button>
        <Button
          size="sm"
          type="button"
          variant="outline"
          onClick={openProofSheet}
          disabled={busy}
          className="gap-1 border-gray-300 text-gray-700 hover:bg-white rounded-xl"
        >
          <FileText className="w-3.5 h-3.5" />
          WPW Proof Sheet
        </Button>
        <Button
          size="sm"
          type="button"
          variant="outline"
          onClick={() => navigate("/designpro")}
          disabled={busy}
          className="gap-1 border-gray-300 text-gray-700 hover:bg-white rounded-xl"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Design in DesignPro
        </Button>
      </div>
    </section>
  );
};
