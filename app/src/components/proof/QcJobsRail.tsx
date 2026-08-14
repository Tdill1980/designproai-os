/**
 * QcJobsRail
 *
 * Lists the shop's recent QC Artboard / DesignPro jobs (panelizer_jobs)
 * with renders so they can email a customer for approval directly from
 * /approvepro — direct, with no admin detour. Mirrors the
 * WpwOrdersRail click model:
 *   - Job already has a linked proof → select that proof in the main
 *     ApproveProPage rail (sets ?id=...).
 *   - No linked proof yet → open SendForApprovalDialog pre-filled with
 *     the job's renders + 2D flat proof + vehicle, with the QC order
 *     number persisted into proof metadata.
 *
 * The link from job → proof is by metadata.wpw_order_number
 * (proof-create stores body.wpw_order_number into metadata; the QC surface
 * passes the QC order_number into wpwOrderNumber).
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SendForApprovalDialog } from "@/components/proof/SendForApprovalDialog";
import {
  Sparkles, Loader2, ArrowRight, Search, CheckCircle2, Send, Eye,
  XCircle, RotateCw, AlertTriangle, Clock, LifeBuoy, ImageIcon,
  FileImage,
} from "lucide-react";
import { cn } from "@/lib/utils";

const VIEW_LABELS: Record<string, string> = {
  hero: "Hero View (3D)",
  side: "Driver Side (3D)",
  "driver-side": "Driver Side (3D)",
  "passenger-side": "Passenger Side (3D)",
  front: "Front View (3D)",
  rear: "Rear View (3D)",
  roof: "Top/Roof View (3D)",
  hood: "Hood View (3D)",
  detail: "Detail View",
};

interface QcJob {
  id: string;
  order_number: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  status: string | null;
  created_at: string;
  all_view_urls: Record<string, unknown> | null;
  concept_json: Record<string, any> | null;
}

type ProofStatus =
  | "draft" | "sent" | "viewed" | "revising" | "approved" | "declined"
  | "revoked" | "expired" | "delivery_failed" | "escalated_shop" | "escalated_support";

interface LinkedProof {
  id: string;
  status: ProofStatus;
  metadata: Record<string, any> | null;
}

const STATUS_BADGE: Record<ProofStatus, { label: string; color: string; icon: typeof Send }> = {
  draft:             { label: "Draft",       color: "bg-gray-100 text-gray-600 border-gray-200", icon: Send },
  sent:              { label: "Sent",        color: "bg-blue-100 text-blue-700 border-blue-200", icon: Send },
  viewed:            { label: "Viewed",      color: "bg-blue-100 text-blue-700 border-blue-200", icon: Eye },
  revising:          { label: "Revising",    color: "bg-purple-100 text-purple-700 border-purple-200", icon: RotateCw },
  approved:          { label: "Approved",    color: "bg-green-100 text-green-700 border-green-200", icon: CheckCircle2 },
  declined:          { label: "Declined",    color: "bg-red-100 text-red-700 border-red-200", icon: XCircle },
  revoked:           { label: "Revoked",     color: "bg-zinc-100 text-gray-400 border-gray-200", icon: XCircle },
  expired:           { label: "Expired",     color: "bg-zinc-100 text-gray-400 border-gray-200", icon: Clock },
  delivery_failed:   { label: "Email failed", color: "bg-red-100 text-red-700 border-red-200", icon: AlertTriangle },
  escalated_shop:    { label: "Shop revising", color: "bg-amber-100 text-amber-700 border-amber-200", icon: RotateCw },
  escalated_support: { label: "Support",     color: "bg-amber-100 text-amber-700 border-amber-200", icon: LifeBuoy },
};

function gatherRenderUrls(job: QcJob): Record<string, string> {
  const out: Record<string, string> = {};
  const cj = (job.concept_json || {}) as Record<string, any>;
  const views = (job.all_view_urls && Object.keys(job.all_view_urls).length > 0)
    ? job.all_view_urls
    : (cj.render_urls || {});
  for (const [k, v] of Object.entries(views || {})) {
    if (typeof v === "string" && v.length > 0) out[k] = v;
  }
  return out;
}

function flatProofUrl(job: QcJob): string | undefined {
  const v = (job.concept_json || {}).flat_proof_url;
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function vehicleOf(j: QcJob): string {
  return [j.vehicle_year, j.vehicle_make, j.vehicle_model]
    .filter(Boolean)
    .join(" ");
}

function previewOf(urls: Record<string, string>, flat?: string): string | null {
  return urls.hero
    || urls.side
    || urls.front
    || urls.rear
    || urls.roof
    || Object.values(urls)[0]
    || flat
    || null;
}

function designNameOf(j: QcJob): string {
  const cj = (j.concept_json || {}) as Record<string, any>;
  return (typeof cj.design_name === "string" && cj.design_name)
    || (typeof cj.designDescription === "string" && cj.designDescription)
    || j.order_number
    || "QC Artboard Design";
}

function isStudioJob(j: QcJob): boolean {
  return (j.concept_json as any)?.source === "graphicspro_studio";
}

export const QcJobsRail = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const [jobs, setJobs] = useState<QcJob[] | null>(null);
  const [proofsByOrder, setProofsByOrder] = useState<Record<string, LinkedProof>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<QcJob | null>(null);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  // Auto-create a draft proof from the QC job's renders so the click lands
  // on the detail pane (status + history + pre-attached artwork) instead of
  // a blank "Send for Client Approval" dialog. Falls back to the dialog if
  // proof-create rejects (e.g. tier limit, no assets).
  const createDraftFromJob = async (job: QcJob) => {
    if (creatingId) return;
    setCreatingId(job.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const placeholderEmail = user?.email;
      if (!placeholderEmail) {
        setSelected(job);
        return;
      }
      const urls = gatherRenderUrls(job);
      const flat = flatProofUrl(job);
      const designName = designNameOf(job);
      const lineItems: Array<{ title: string; description: string; render_url: string }> = [];
      if (flat) {
        lineItems.push({
          title: "2D Flat Panel Design",
          description: `${designName} — print-ready flat artwork`,
          render_url: flat,
        });
      }
      Object.entries(urls).forEach(([key, url]) => {
        lineItems.push({
          title: VIEW_LABELS[key] || key.replace(/-|_/g, " "),
          description: `${designName} — ${key} angle`,
          render_url: url,
        });
      });
      if (lineItems.length === 0) {
        setSelected(job);
        return;
      }
      const { data, error } = await supabase.functions.invoke("proof-create", {
        body: {
          customer_email: placeholderEmail,
          mode: "revision_loop",
          design_name: designName,
          vehicle_year: job.vehicle_year ? String(job.vehicle_year) : undefined,
          vehicle_make: job.vehicle_make || undefined,
          vehicle_model: job.vehicle_model || undefined,
          line_items: lineItems,
          wpw_order_id: job.id,
          wpw_order_number: job.order_number || undefined,
          internal_notes: `Auto-created from QC Artboard job #${job.order_number || job.id}. Update customer email before sending.`,
        },
      });
      const proofId = (data as any)?.proof_id;
      if (error || !proofId) {
        const msg = (data as any)?.error || error?.message || "Could not create draft";
        toast({ title: "Couldn't auto-create draft", description: msg, variant: "destructive" });
        setSelected(job);
        return;
      }
      if (job.order_number) {
        setProofsByOrder((prev) => ({
          ...prev,
          [job.order_number as string]: { id: proofId, status: "draft", metadata: {} },
        }));
      }
      toast({
        title: "Draft proof ready",
        description: "Update the customer email below and hit Send when you're ready.",
      });
      setSearchParams({ id: proofId }, { replace: true });
    } finally {
      setCreatingId(null);
    }
  };

  useEffect(() => {
    (async () => {
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
          .limit(120);
        if (error) {
          setJobs([]);
          return;
        }
        const withAssets = (data || []).filter((j: any) => {
          const urls = gatherRenderUrls(j as QcJob);
          return Object.keys(urls).length > 0 || flatProofUrl(j as QcJob);
        }) as QcJob[];
        setJobs(withAssets);

        // Pull any proof_approvals already linked to these QC orders so the
        // rail can show status badges + jump straight to the proof detail.
        const orderNumbers = withAssets
          .map((j) => j.order_number)
          .filter((s): s is string => !!s);
        if (orderNumbers.length > 0) {
          const { data: proofs } = await supabase
            .from("proof_approvals" as any)
            .select("id, status, metadata")
            .eq("shop_id", user.id)
            .in("metadata->>wpw_order_number", orderNumbers as any)
            .order("updated_at", { ascending: false });

          const map: Record<string, LinkedProof> = {};
          (proofs as any[] | null)?.forEach((p) => {
            const ord = p?.metadata?.wpw_order_number;
            // Skip revoked / expired proofs — they're dead and tapping
            // them would route the shop to a useless detail page. Treat
            // the QC job as "no live proof" so clicking opens a fresh
            // SendForApprovalDialog instead.
            if (p.status === "revoked" || p.status === "expired") return;
            if (typeof ord === "string" && !map[ord]) {
              map[ord] = p as LinkedProof;
            }
          });
          setProofsByOrder(map);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!jobs) return [];
    const q = search.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((j) =>
      [j.order_number, vehicleOf(j), designNameOf(j)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [jobs, search]);

  const summary = useMemo(() => {
    if (!jobs) return null;
    const total = jobs.length;
    const linked = Object.keys(proofsByOrder).length;
    return { total, linked };
  }, [jobs, proofsByOrder]);

  if (loading) {
    return (
      <Card className="p-3 flex items-center gap-2 text-xs text-muted-foreground border-dashed">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading QC Artboard jobs…
      </Card>
    );
  }
  if (!jobs || jobs.length === 0) return null;

  return (
    <>
      <Card className="p-3 space-y-2 border-cyan-200 bg-gradient-to-br from-cyan-50/60 to-blue-50/60">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="w-full flex items-center gap-1.5 flex-wrap text-left"
        >
          <Sparkles className="w-3.5 h-3.5 text-cyan-700" />
          <h3 className="text-xs font-bold text-cyan-900 uppercase tracking-wider">
            QC Artboard Jobs
          </h3>
          {summary && (
            <Badge variant="outline" className="text-[9px] h-4 px-1 bg-white/70 border-cyan-200 text-cyan-700">
              {summary.linked}/{summary.total} sent
            </Badge>
          )}
          <ArrowRight
            className={cn(
              "w-3 h-3 ml-auto text-cyan-700 transition-transform",
              collapsed ? "rotate-0" : "rotate-90",
            )}
          />
        </button>
        {!collapsed && (
          <p className="text-[11px] text-cyan-900/70">
            Tap a design to email it for approval — or jump to its open
            proof if one already exists.
          </p>
        )}

        {!collapsed && (
          <>
            <div className="relative">
              <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-cyan-700/60" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search RP-order, vehicle…"
                className="pl-7 h-8 text-xs bg-white/80 border-cyan-200"
              />
            </div>

            <div className="space-y-1.5 max-h-[360px] overflow-y-auto pr-1">
              {filtered.length === 0 && (
                <p className="text-[11px] text-cyan-900/70 italic px-1 py-2">
                  No QC jobs match this search.
                </p>
              )}
              {filtered.map((job) => {
                const urls = gatherRenderUrls(job);
                const flat = flatProofUrl(job);
                const preview = previewOf(urls, flat);
                const linked = job.order_number ? proofsByOrder[job.order_number] : null;
                const cfg = linked ? STATUS_BADGE[linked.status] : null;
                const Icon = cfg?.icon;
                const viewCount = Object.keys(urls).length;
                return (
                  <button
                    key={job.id}
                    type="button"
                    disabled={creatingId === job.id}
                    onClick={() => {
                      // GraphicsPro Studio jobs go to the cut-contour QC
                      // artboard — they're flat output, not vehicle panels,
                      // so the proof-create / DesignPro send-for-approval
                      // flow doesn't apply.
                      if (isStudioJob(job)) {
                        navigate(`/qc-cutcontour?id=${job.id}`);
                        return;
                      }
                      if (linked) {
                        setSearchParams({ id: linked.id }, { replace: true });
                        return;
                      }
                      createDraftFromJob(job);
                    }}
                    className={cn(
                      "w-full text-left rounded-md border bg-white/70",
                      "hover:bg-white transition-colors p-2",
                      linked
                        ? "border-cyan-300 hover:border-cyan-500"
                        : "border-cyan-200/60 hover:border-cyan-400",
                      creatingId === job.id && "opacity-60 cursor-wait",
                    )}
                  >
                    <div className="flex gap-2 items-center">
                      <div className="w-10 h-10 rounded bg-zinc-100 overflow-hidden shrink-0 flex items-center justify-center">
                        {preview ? (
                          <img src={preview} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <ImageIcon className="w-4 h-4 text-zinc-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-[12px] font-semibold text-zinc-900 truncate">
                            {designNameOf(job)}
                          </p>
                          {cfg && Icon && (
                            <Badge variant="outline" className={cn("text-[8px] h-3.5 px-1 shrink-0", cfg.color)}>
                              <Icon className="w-2.5 h-2.5 mr-0.5" />
                              {cfg.label}
                            </Badge>
                          )}
                        </div>
                        <p className="text-[10px] text-zinc-600 truncate">
                          {vehicleOf(job) || "—"}
                        </p>
                        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                          {job.order_number && (
                            <span className="text-[9px] font-mono text-cyan-700 font-semibold">
                              #{job.order_number}
                            </span>
                          )}
                          <span className="text-[9px] text-zinc-500">·</span>
                          <span className="text-[9px] text-zinc-500">
                            {viewCount} view{viewCount === 1 ? "" : "s"}
                          </span>
                          {flat && (
                            <Badge variant="outline" className="text-[8px] h-3.5 px-1 border-purple-200 text-purple-700 bg-purple-50">
                              <FileImage className="w-2.5 h-2.5 mr-0.5" />
                              2D
                            </Badge>
                          )}
                        </div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </Card>

      {selected && (() => {
        const urls = gatherRenderUrls(selected);
        const flat = flatProofUrl(selected);
        return (
          <SendForApprovalDialog
            open={!!selected}
            onOpenChange={(v) => !v && setSelected(null)}
            context={{
              renderUrls: urls,
              flatPanelUrl: flat,
              vehicleYear: selected.vehicle_year ? String(selected.vehicle_year) : undefined,
              vehicleMake: selected.vehicle_make || undefined,
              vehicleModel: selected.vehicle_model || undefined,
              designName: designNameOf(selected),
              defaultMode: "revision_loop",
              wpwOrderId: selected.id,
              wpwOrderNumber: selected.order_number || undefined,
            }}
          />
        );
      })()}
    </>
  );
};
