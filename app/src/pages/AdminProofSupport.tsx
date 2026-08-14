/**
 * AdminProofSupport — Phase 5 admin dashboard for Tier-3 escalations.
 *
 * Shows all support_escalations rows with status filter. Admin can:
 *   - See the proof summary + escalation reason at a glance
 *   - Open the public client page (read-only)
 *   - Open the shop-owner manage page
 *   - Download the frozen snapshot as JSON (full forensic context)
 *   - Update the status (open → in_progress → resolved / abandoned)
 *
 * Route: /admin/proof-support — wrapped in RequireAdmin.
 * RLS on support_escalations gates access to admin/tester only.
 */

import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Loader2,
  ExternalLink,
  Download,
  CheckCircle2,
  XCircle,
  PlayCircle,
  LifeBuoy,
  Filter,
  RefreshCw,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";

type EscalationStatus = "open" | "in_progress" | "resolved" | "abandoned";

interface EscalationRow {
  id: string;
  proof_id: string;
  escalated_by_role: "shop" | "customer";
  escalated_by_user_id: string | null;
  reason: string | null;
  status: EscalationStatus;
  assigned_to_user_id: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  snapshot: {
    proof?: any;
    versions?: any[];
    events?: any[];
    snapshot_at?: string;
  };
  created_at: string;
  updated_at: string;
}

const STATUS_CONFIG: Record<EscalationStatus, { label: string; color: string; icon: typeof LifeBuoy }> = {
  open: { label: "Open", color: "bg-red-100 text-red-700 border-red-200", icon: LifeBuoy },
  in_progress: { label: "In Progress", color: "bg-blue-100 text-blue-700 border-blue-200", icon: PlayCircle },
  resolved: { label: "Resolved", color: "bg-green-100 text-green-700 border-green-200", icon: CheckCircle2 },
  abandoned: { label: "Abandoned", color: "bg-zinc-100 text-zinc-700 border-zinc-200", icon: XCircle },
};

export default function AdminProofSupport() {
  const { toast } = useToast();
  const [rows, setRows] = useState<EscalationRow[] | null>(null);
  const [filter, setFilter] = useState<EscalationStatus | "all">("open");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<EscalationRow | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [savingStatus, setSavingStatus] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("support_escalations" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (filter !== "all") query = query.eq("status", filter);
      const { data, error } = await query;
      if (error) {
        toast({
          title: "Failed to load escalations",
          description: error.message,
          variant: "destructive",
        });
        setRows([]);
      } else {
        setRows((data || []) as unknown as EscalationRow[]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const updateStatus = async (status: EscalationStatus) => {
    if (!selected) return;
    setSavingStatus(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const update: Record<string, unknown> = {
        status,
        assigned_to_user_id: user?.id || null,
      };
      if (status === "resolved" || status === "abandoned") {
        update.resolved_at = new Date().toISOString();
        update.resolution_notes = resolutionNotes.trim() || null;
      }
      if (status === "in_progress") {
        update.resolved_at = null;
      }
      const { error } = await supabase
        .from("support_escalations" as any)
        .update(update as any)
        .eq("id", selected.id);

      if (error) {
        toast({
          title: "Update failed",
          description: error.message,
          variant: "destructive",
        });
        setSavingStatus(false);
        return;
      }
      toast({
        title: `Marked ${STATUS_CONFIG[status].label}`,
      });
      setSelected(null);
      setResolutionNotes("");
      await load();
    } finally {
      setSavingStatus(false);
    }
  };

  const downloadSnapshot = (row: EscalationRow) => {
    const blob = new Blob([JSON.stringify(row.snapshot, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `proof-escalation-${row.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-zinc-50 pb-12">
      <Helmet><title>Proof Support · Admin</title></Helmet>

      <header className="bg-white border-b border-zinc-200">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LifeBuoy className="w-6 h-6 text-amber-600" />
            <div>
              <h1 className="text-xl font-semibold">Proof Support Escalations</h1>
              <p className="text-xs text-zinc-500">
                Tier-3 handoffs from shops. Snapshot + Slack alerts fire at escalation time.
              </p>
            </div>
          </div>
          <Button onClick={load} variant="outline" size="sm" className="gap-1">
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        {/* Filter bar */}
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-zinc-500" />
          {(["open", "in_progress", "resolved", "abandoned", "all"] as const).map((k) => (
            <Button
              key={k}
              variant={filter === k ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(k)}
              className="capitalize"
            >
              {k === "all" ? "All" : STATUS_CONFIG[k as EscalationStatus].label}
            </Button>
          ))}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
          </div>
        )}

        {!loading && rows && rows.length === 0 && (
          <Card className="p-12 text-center text-zinc-500">
            <LifeBuoy className="w-10 h-10 mx-auto mb-3 text-zinc-300" />
            <p className="text-sm">No escalations in this filter.</p>
          </Card>
        )}

        {!loading && rows && rows.length > 0 && (
          <ol className="space-y-3">
            {rows.map((r) => {
              const cfg = STATUS_CONFIG[r.status];
              const StatusIcon = cfg.icon;
              const proof = r.snapshot?.proof || {};
              const vehicle = [proof.vehicle_year, proof.vehicle_make, proof.vehicle_model]
                .filter(Boolean).join(" ");
              const versionCount = Array.isArray(r.snapshot?.versions) ? r.snapshot.versions.length : 0;
              const eventCount = Array.isArray(r.snapshot?.events) ? r.snapshot.events.length : 0;
              return (
                <li key={r.id}>
                  <Card className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex-1 min-w-[240px]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-zinc-900">
                            {proof.design_name || "Vehicle Wrap Design"}
                          </h3>
                          <Badge
                            variant="outline"
                            className={cn("text-[10px] font-medium", cfg.color)}
                          >
                            <StatusIcon className="w-3 h-3 mr-1" />
                            {cfg.label}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] capitalize">
                            {r.escalated_by_role}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-zinc-600 space-y-0.5">
                          {vehicle && <p>{vehicle}</p>}
                          <p>
                            Customer: <span className="text-zinc-900">{proof.customer_name || proof.customer_email || "—"}</span>
                            {" · "}
                            {versionCount} version{versionCount === 1 ? "" : "s"} · {eventCount} event{eventCount === 1 ? "" : "s"}
                          </p>
                          <p>
                            Escalated {new Date(r.created_at).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {proof.view_token && (
                          <Button
                            asChild
                            variant="outline"
                            size="sm"
                            className="gap-1"
                          >
                            <a href={`/approve/${proof.view_token}`} target="_blank" rel="noopener noreferrer">
                              <Eye className="w-3.5 h-3.5" />
                              Client view
                            </a>
                          </Button>
                        )}
                        {proof.manage_token && (
                          <Button
                            asChild
                            variant="outline"
                            size="sm"
                            className="gap-1"
                          >
                            <a href={`/approve/manage/${proof.manage_token}`} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="w-3.5 h-3.5" />
                              Shop page
                            </a>
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => downloadSnapshot(r)}
                          className="gap-1"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Snapshot
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            setSelected(r);
                            setResolutionNotes(r.resolution_notes || "");
                          }}
                        >
                          Manage
                        </Button>
                      </div>
                    </div>
                    {r.reason && (
                      <div className="rounded-md bg-zinc-50 border border-zinc-200 p-3 text-sm text-zinc-800 whitespace-pre-wrap">
                        {r.reason}
                      </div>
                    )}
                  </Card>
                </li>
              );
            })}
          </ol>
        )}
      </main>

      {/* Manage dialog */}
      <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent className="max-w-md">
          {selected && (
            <>
              <DialogTitle className="flex items-center gap-2">
                <LifeBuoy className="w-4 h-4 text-amber-600" />
                Manage escalation
              </DialogTitle>
              <DialogDescription>
                Move this through the support workflow. Current status:{" "}
                <span className="font-medium">{STATUS_CONFIG[selected.status].label}</span>
              </DialogDescription>

              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-500">Resolution notes</Label>
                  <Textarea
                    value={resolutionNotes}
                    onChange={(e) => setResolutionNotes(e.target.value)}
                    placeholder="Short summary for the audit trail…"
                    className="min-h-[80px]"
                    disabled={savingStatus}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    onClick={() => updateStatus("in_progress")}
                    disabled={savingStatus || selected.status === "in_progress"}
                    className="gap-1"
                  >
                    <PlayCircle className="w-4 h-4" />
                    Take it
                  </Button>
                  <Button
                    onClick={() => updateStatus("resolved")}
                    disabled={savingStatus}
                    className="gap-1 bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Resolved
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => updateStatus("abandoned")}
                    disabled={savingStatus}
                    className="gap-1"
                  >
                    <XCircle className="w-4 h-4" />
                    Abandon
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setSelected(null)}
                    disabled={savingStatus}
                  >
                    Close
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
