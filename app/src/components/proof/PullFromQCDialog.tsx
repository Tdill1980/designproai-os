/**
 * PullFromQCDialog
 *
 * Lets a shop attach renders from an existing QC Artboard / DesignPro job
 * (panelizer_jobs) to a proof_approvals row, so the auto-ingested WPW
 * proof and the design done in QC become one record without re-uploading
 * files. Calls proof-save-version with the QC job's render_urls (3D views
 * + the flat 2D proof) and bumps the active version.
 */

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Search, Link2, ImageIcon, FileImage, CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ApproveProBrand } from "@/components/proof/ApproveProBrand";

interface PullFromQCDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  proofId: string;
  onAttached: () => void;
}

interface QcJob {
  id: string;
  order_number: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  status: string | null;
  created_at: string;
  all_view_urls: Record<string, string> | null;
  concept_json: Record<string, any> | null;
}

function gatherRenderUrls(job: QcJob): Record<string, string> {
  const out: Record<string, string> = {};
  const cj = (job.concept_json || {}) as Record<string, any>;
  // Prefer the column copy; fall back to the concept_json copy.
  const views = (job.all_view_urls && Object.keys(job.all_view_urls).length > 0)
    ? job.all_view_urls
    : (cj.render_urls || {});
  for (const [k, v] of Object.entries(views || {})) {
    if (typeof v === "string" && v.length > 0) out[k] = v;
  }
  // Surface the 2D flat proof as a dedicated key so ApprovePro shows it
  // first in the line-items grid.
  const flat = cj.flat_proof_url;
  if (typeof flat === "string" && flat.length > 0) {
    out["flat_2d_proof"] = flat;
  }
  return out;
}

function vehicleOf(j: QcJob): string {
  return [j.vehicle_year, j.vehicle_make, j.vehicle_model]
    .filter(Boolean)
    .join(" ");
}

function previewOf(urls: Record<string, string>): string | null {
  return urls.flat_2d_proof
    || urls.hero
    || urls.side
    || urls.front
    || urls.rear
    || urls.roof
    || Object.values(urls)[0]
    || null;
}

export const PullFromQCDialog = ({
  open, onOpenChange, proofId, onAttached,
}: PullFromQCDialogProps) => {
  const { toast } = useToast();
  const [jobs, setJobs] = useState<QcJob[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setJobs([]);
          return;
        }
        const { data, error } = await supabase
          .from("panelizer_jobs")
          .select("id, order_number, vehicle_year, vehicle_make, vehicle_model, status, created_at, all_view_urls, concept_json")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(60);
        if (error) {
          toast({ title: "Failed to load QC jobs", description: error.message, variant: "destructive" });
          setJobs([]);
        } else {
          // Only show jobs that actually have something attachable.
          const withAssets = (data || []).filter((j: any) => {
            const urls = gatherRenderUrls(j as QcJob);
            return Object.keys(urls).length > 0;
          });
          setJobs(withAssets as unknown as QcJob[]);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [open, toast]);

  const filtered = (jobs || []).filter((j) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [j.order_number, vehicleOf(j)]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
  });

  const handleAttach = async () => {
    if (!pickedId) return;
    const job = (jobs || []).find((j) => j.id === pickedId);
    if (!job) return;
    const urls = gatherRenderUrls(job);
    if (Object.keys(urls).length === 0) {
      toast({ title: "Nothing to attach", description: "This job has no renders yet.", variant: "destructive" });
      return;
    }
    setAttaching(true);
    try {
      const noteParts: string[] = [];
      if (job.order_number) noteParts.push(`QC ${job.order_number}`);
      const veh = vehicleOf(job);
      if (veh) noteParts.push(veh);
      const shopMessage = `Pulled from QC Artboard${noteParts.length ? ` — ${noteParts.join(" · ")}` : ""}`;

      const { data, error } = await supabase.functions.invoke("proof-save-version", {
        body: {
          proof_id: proofId,
          render_urls: urls,
          shop_message: shopMessage,
        },
        headers: {
          "Idempotency-Key": `pull-qc-${proofId}-${pickedId}-${Date.now()}`,
        },
      });
      if (error || !data?.success) {
        throw new Error((data as any)?.error || error?.message || "Attach failed");
      }
      toast({
        title: "Design attached",
        description: `v${data.version_number} now active with ${Object.keys(urls).length} view(s)`,
      });
      onAttached();
      onOpenChange(false);
      setPickedId(null);
    } catch (err: any) {
      toast({ title: "Attach failed", description: err.message, variant: "destructive" });
    } finally {
      setAttaching(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(v) : onOpenChange(false))}>
      <DialogContent className="max-w-2xl bg-white text-zinc-900 border-zinc-200 flex flex-col max-h-[85vh] p-0 gap-0 overflow-hidden">
        <ApproveProBrand subtitle="Pull design from QC Artboard" />
        <div className="shrink-0 px-6 pt-4 pb-3 border-b border-zinc-200 space-y-2">
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5 text-blue-600" />
            Pull design from QC Artboard
          </DialogTitle>
          <DialogDescription>
            Attach an existing QC Artboard / DesignPro job's renders + 2D
            flat proof to this approval — no re-uploading from your computer.
          </DialogDescription>
          <div className="relative pt-1">
            <Search className="absolute left-2.5 top-3.5 w-4 h-4 text-zinc-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search RP-order, vehicle…"
              className="pl-8 h-9 text-sm"
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <p className="text-sm text-zinc-500 text-center py-12 italic">
              {jobs && jobs.length === 0
                ? "No QC Artboard jobs with renders yet. Generate a design in QC Artboard first, then come back."
                : "No QC jobs match this search."}
            </p>
          )}
          {filtered.map((job) => {
            const urls = gatherRenderUrls(job);
            const preview = previewOf(urls);
            const viewCount = Object.keys(urls).length;
            const hasFlat = !!urls.flat_2d_proof;
            const isPicked = job.id === pickedId;
            return (
              <button
                type="button"
                key={job.id}
                onClick={() => setPickedId(job.id)}
                className={cn(
                  "w-full text-left rounded-lg border p-3 flex gap-3 transition-colors",
                  isPicked
                    ? "border-blue-500 bg-blue-50 ring-1 ring-blue-300"
                    : "border-zinc-200 bg-white hover:border-blue-300 hover:bg-blue-50/40",
                )}
              >
                <div className="w-20 h-16 rounded overflow-hidden bg-zinc-100 shrink-0 flex items-center justify-center">
                  {preview ? (
                    <img src={preview} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon className="w-5 h-5 text-zinc-300" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-sm font-semibold truncate">
                      {job.order_number || "QC Job"}
                    </p>
                    {isPicked && (
                      <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-600 truncate">
                    {vehicleOf(job) || "—"}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <Badge variant="outline" className="text-[9px] h-4 px-1 border-blue-200 text-blue-700 bg-blue-50">
                      <ImageIcon className="w-2.5 h-2.5 mr-0.5" />
                      {viewCount} view{viewCount === 1 ? "" : "s"}
                    </Badge>
                    {hasFlat && (
                      <Badge variant="outline" className="text-[9px] h-4 px-1 border-purple-200 text-purple-700 bg-purple-50">
                        <FileImage className="w-2.5 h-2.5 mr-0.5" />
                        2D proof
                      </Badge>
                    )}
                    {job.status && (
                      <Badge variant="outline" className="text-[9px] h-4 px-1 bg-zinc-50 text-zinc-600">
                        {job.status}
                      </Badge>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="shrink-0 px-6 py-3 border-t border-zinc-200 grid grid-cols-2 gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={attaching}>
            Cancel
          </Button>
          <Button
            onClick={handleAttach}
            disabled={!pickedId || attaching}
            className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:opacity-90 border-0"
          >
            {attaching ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Attaching…</>
            ) : (
              <><Link2 className="w-4 h-4 mr-2" /> Attach to this proof</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
