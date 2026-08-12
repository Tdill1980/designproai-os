import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ExternalLink, RefreshCw, FileCheck2, Loader2, Link2, Upload, Package, Eye } from "lucide-react";
import { ProductionPanelProof, type ProofPanel } from "@/components/qc/ProductionPanelProof";

// Lifecycle the admin drives a paid request through. Customers only ever
// see these as status labels (via MyProductionPacksCard / their dashboard).
const PRODUCTION_STATUSES = [
  "awaiting_payment",
  "paid_submitted",
  "in_production",
  "files_ready",
  "completed",
] as const;
type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

const STATUS_LABEL: Record<ProductionStatus, string> = {
  awaiting_payment: "Awaiting Payment",
  paid_submitted: "Paid / Submitted",
  in_production: "In Production",
  files_ready: "Files Ready",
  completed: "Completed",
};

const STATUS_TONE: Record<ProductionStatus, string> = {
  awaiting_payment: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  paid_submitted: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
  in_production: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  files_ready: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  completed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

// Maps the print-production lifecycle onto the panelizer_jobs status +
// current_stage that ProductionFlow's GENIE progress bar (PIPELINE_STAGES)
// reads, so advancing a request here moves the customer's progress bar.
const PANELIZER_STAGE_MAP: Partial<Record<ProductionStatus, { status: string; stage: number }>> = {
  paid_submitted: { status: "panelizing", stage: 0 },
  in_production: { status: "packaging", stage: 3 },
  files_ready: { status: "ready", stage: 6 },
  completed: { status: "ready", stage: 6 },
};

interface PrintRequest {
  id: string;
  user_id: string;
  customer_name: string | null;
  design_id: string | null;
  order_number: string | null;
  panelizer_job_id: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  approved_proof_url: string | null;
  requested_output_type: string | null;
  payment_status: string | null;
  production_status: ProductionStatus;
  due_date: string | null;
  final_files: any[] | null;
  created_at: string;
}

export default function AdminPrintProduction() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [jobIdInput, setJobIdInput] = useState("");
  const [fileUrlInput, setFileUrlInput] = useState("");
  const [filesForId, setFilesForId] = useState<string | null>(null);

  const { data: requests, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["print-production-queue"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("print_production_requests" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as PrintRequest[];
    },
    refetchInterval: 30_000,
  });

  const patch = useMutation({
    mutationFn: async ({ id, fields }: { id: string; fields: Record<string, any> }) => {
      const { error } = await supabase
        .from("print_production_requests" as any)
        .update(fields)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["print-production-queue"] });
    },
    onError: (e: any) => toast.error(e.message || "Update failed"),
  });

  const setStatus = (req: PrintRequest, production_status: ProductionStatus) => {
    // Update the request status...
    patch.mutate({ id: req.id, fields: { production_status } });
    // ...and drive the customer-facing GENIE panelizer progress bar on
    // ProductionFlow by writing through to the linked panelizer job.
    if (req.panelizer_job_id) {
      const mapped = PANELIZER_STAGE_MAP[production_status];
      if (mapped) {
        supabase
          .from("panelizer_jobs" as any)
          .update({ status: mapped.status, current_stage: mapped.stage })
          .eq("id", req.panelizer_job_id)
          .then(({ error }) => {
            if (error) toast.error(`Progress bar not updated: ${error.message}`);
          });
      }
    }
  };

  const linkJob = (id: string) => {
    const jobId = jobIdInput.trim();
    if (!jobId) { toast.error("Paste a panelizer job id."); return; }
    patch.mutate(
      { id, fields: { panelizer_job_id: jobId } },
      { onSuccess: () => { toast.success("Linked to QC job."); setLinkingId(null); setJobIdInput(""); } },
    );
  };

  const addFinalFile = (req: PrintRequest) => {
    const url = fileUrlInput.trim();
    if (!url) { toast.error("Paste a file URL."); return; }
    const next = [...(req.final_files || []), { url, added_at: new Date().toISOString() }];
    patch.mutate(
      { id: req.id, fields: { final_files: next } },
      { onSuccess: () => { toast.success("File added."); setFileUrlInput(""); setFilesForId(null); } },
    );
  };

  const markReady = (req: PrintRequest) => {
    if (!(req.final_files && req.final_files.length > 0)) {
      toast.error("Add at least one final file before marking ready.");
      return;
    }
    patch.mutate(
      { id: req.id, fields: { production_status: "files_ready" } },
      { onSuccess: () => toast.success("Customer can now download the files.") },
    );
  };

  // Carley uploads her COMPLETED panels (real TIFFs built on templates
  // off-platform). Filenames like driver_side_172x59.5in.tiff carry the side
  // + dimensions, so the pack shows each panel correctly.
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  function parsePanelName(fname: string): { view?: string; widthIn?: number; heightIn?: number } {
    const m = fname.match(/([a-z_]+?)[_-](\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/i);
    if (!m) return {};
    return { view: m[1].replace(/-/g, "_"), widthIn: parseFloat(m[2]), heightIn: parseFloat(m[3]) };
  }
  const uploadCompleted = async (req: PrintRequest, files: FileList) => {
    setUploadingId(req.id);
    try {
      const added: any[] = [];
      for (const file of Array.from(files)) {
        const path = `print-production/${req.id}/completed/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
        const { error } = await supabase.storage.from("renders").upload(path, file, {
          contentType: file.type || "application/octet-stream",
        });
        if (error) throw error;
        const url = supabase.storage.from("renders").getPublicUrl(path).data.publicUrl;
        added.push({ url, name: file.name, ...parsePanelName(file.name) });
      }
      const next = [...(req.final_files || []), ...added];
      patch.mutate({ id: req.id, fields: { final_files: next } });
      toast.success(`Uploaded ${added.length} completed panel${added.length > 1 ? "s" : ""}.`);
    } catch (e: any) {
      toast.error(e.message || "Upload failed");
    } finally {
      setUploadingId(null);
    }
  };

  // Pre-send review: show exactly what will be zipped before it goes out.
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const proofPanelsFor = (req: PrintRequest): ProofPanel[] =>
    (req.final_files || []).map((f: any) => ({
      view: f.view || "panel",
      name: f.name || "",
      widthIn: Number(f.widthIn) || 0,
      heightIn: Number(f.heightIn) || 0,
      bleedIn: 1.5,
      imageUrl: f.url,
    }));

  // Zip Carley's completed panels (+ proof) into a production pack and load
  // it to the customer's WrapBox.
  const [packagingId, setPackagingId] = useState<string | null>(null);
  const sendToWrapbox = async (req: PrintRequest) => {
    if (!(req.final_files || []).length) { toast.error("Upload Carley's completed panels first."); return; }
    setPackagingId(req.id);
    try {
      const { data, error } = await supabase.functions.invoke("deploy-to-wrapbox", {
        body: { job_id: req.panelizer_job_id, request_id: req.id, final_files: req.final_files, dp_stamp: true },
      });
      if (error) throw error;
      patch.mutate({ id: req.id, fields: { production_status: "completed" } });
      setReviewingId(null);
      toast.success(`Zipped & sent to WrapBox (${data?.fileCount ?? (req.final_files || []).length} files) — customer notified.`);
    } catch (e: any) {
      toast.error(e.message || "WrapBox packaging failed");
    } finally {
      setPackagingId(null);
    }
  };


  return (
    <div className="min-h-screen bg-black text-white px-4 py-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold font-['Oswald'] tracking-wide">Print Production Queue</h1>
          <p className="text-sm text-white/60 mt-1">
            Paid customer requests for print-ready files. Draw panels &amp; generate in QC Artboard,
            then mark files ready for the customer to download.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-white/60"><Loader2 className="h-4 w-4 animate-spin" /> Loading queue…</div>
      ) : !requests || requests.length === 0 ? (
        <Card className="bg-white/5 border-white/10"><CardContent className="py-12 text-center text-white/50">
          No print production requests yet.
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => {
            const vehicle = [req.vehicle_year, req.vehicle_make, req.vehicle_model].filter(Boolean).join(" ") || "—";
            const tone = STATUS_TONE[req.production_status] || STATUS_TONE.awaiting_payment;
            return (
              <Card key={req.id} className="bg-white/5 border-white/10">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between gap-3">
                    <span className="flex items-center gap-3">
                      {req.approved_proof_url && (
                        <img src={req.approved_proof_url} alt="proof" className="h-12 w-20 object-cover rounded border border-white/10" />
                      )}
                      <span>
                        <span className="block">{req.customer_name || "Customer"}</span>
                        <span className="block text-xs font-normal text-white/50">
                          {vehicle} · {req.order_number || req.design_id || req.id.slice(0, 8)}
                        </span>
                      </span>
                    </span>
                    <Badge className={tone}>{STATUS_LABEL[req.production_status]}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-white/70">
                    <div><span className="text-white/40 block">Payment</span>{req.payment_status || "—"}</div>
                    <div><span className="text-white/40 block">Output</span>{req.requested_output_type || "—"}</div>
                    <div><span className="text-white/40 block">Due</span>{req.due_date ? new Date(req.due_date).toLocaleDateString() : "—"}</div>
                    <div><span className="text-white/40 block">Files</span>{(req.final_files || []).length}</div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">

                    <Select value={req.production_status} onValueChange={(v) => setStatus(req, v as ProductionStatus)}>
                      <SelectTrigger className="h-9 w-44 bg-white/5 border-white/10 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PRODUCTION_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Button size="sm" variant="outline" onClick={() => markReady(req)}>
                      <FileCheck2 className="h-4 w-4 mr-1.5" /> Mark Files Ready
                    </Button>

                    <label>
                      <input type="file" multiple accept=".tif,.tiff,image/*,application/pdf" className="hidden"
                        onChange={(e) => { if (e.target.files?.length) uploadCompleted(req, e.target.files); }} />
                      <span className="inline-flex items-center gap-1.5 cursor-pointer rounded-md border border-white/10 hover:bg-white/5 text-xs font-medium px-3 h-9">
                        {uploadingId === req.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        Upload completed panels
                      </span>
                    </label>

                    <Button size="sm" onClick={() => setReviewingId(reviewingId === req.id ? null : req.id)}
                      className="bg-emerald-600 hover:bg-emerald-500">
                      <Eye className="h-4 w-4 mr-1.5" /> Review &amp; Send to WrapBox
                    </Button>

                    {!req.panelizer_job_id && (
                      <Button size="sm" variant="ghost" onClick={() => setLinkingId(linkingId === req.id ? null : req.id)}>
                        <Link2 className="h-4 w-4 mr-1.5" /> Link QC job
                      </Button>
                    )}
                  </div>

                  {(req.final_files || []).length > 0 && (
                    <div className="rounded-lg border border-white/10 p-2 space-y-1">
                      <span className="text-[11px] uppercase tracking-wider text-white/40">Completed panels in pack</span>
                      {(req.final_files || []).map((f: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-xs text-white/70">
                          <span className="truncate">{f.view ? `${f.view.replace(/_/g, " ")}` : f.name || f.url}</span>
                          <span className="text-white/40 ml-2 shrink-0">{f.widthIn && f.heightIn ? `${f.widthIn}×${f.heightIn} in` : ""}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {reviewingId === req.id && (
                    <div className="space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                      <p className="text-xs text-emerald-300">
                        Review — this is exactly what will be zipped and sent to {req.customer_name || "the customer"}'s WrapBox:
                      </p>
                      {(req.final_files || []).length === 0 ? (
                        <p className="text-xs text-amber-300">No completed panels uploaded yet. Upload them before sending.</p>
                      ) : (
                        <ProductionPanelProof
                          vehicleYear={req.vehicle_year}
                          vehicleMake={req.vehicle_make}
                          vehicleModel={req.vehicle_model}
                          panels={proofPanelsFor(req)}
                        />
                      )}
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={() => sendToWrapbox(req)}
                          disabled={packagingId === req.id || (req.final_files || []).length === 0}
                          className="bg-emerald-600 hover:bg-emerald-500">
                          {packagingId === req.id ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Package className="h-4 w-4 mr-1.5" />}
                          Confirm — Zip &amp; Send
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setReviewingId(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}

                  {linkingId === req.id && (
                    <div className="flex items-center gap-2">
                      <Input value={jobIdInput} onChange={(e) => setJobIdInput(e.target.value)}
                        placeholder="panelizer_jobs id" className="h-9 bg-white/5 border-white/10 text-xs" />
                      <Button size="sm" onClick={() => linkJob(req.id)}>Link</Button>
                    </div>
                  )}

                  {filesForId === req.id && (
                    <div className="flex items-center gap-2">
                      <Input value={fileUrlInput} onChange={(e) => setFileUrlInput(e.target.value)}
                        placeholder="final file URL (PNG/PDF/SVG)" className="h-9 bg-white/5 border-white/10 text-xs" />
                      <Button size="sm" onClick={() => addFinalFile(req)}>Add</Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
