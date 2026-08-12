import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Package, ShieldCheck, Download, Loader2, Check, X, Stamp,
  Ruler, BadgeCheck, FileText, Layers,
} from "lucide-react";
import { formatDid, parseAdminNotes } from "@/lib/designId";

/**
 * ProductionPackQCCard — the DesignProAI Human Quality Control surface on the
 * PanelPro Studio board. Rebuilt 2026-07-30 (Trish, sole owner): a VISUAL,
 * demo-ready step flow the human design team runs on camera. Nothing here reuses
 * the old (broken) stamp/QC orchestration — the stamp, approval, and WrapBox
 * delivery are all fresh and deterministic.
 *
 * The flow, exactly as the team performs it:
 *   1. Validate dimensions against the 2D Production Proof (shown inline).
 *   2. Download the hi-res per-side panels, lay each on the vehicle template,
 *      and tick "fits" as they go.
 *   3. Final quality checks (print resolution, 3D proofs, all sides present).
 *   4. Approve → draws the branded DesignProAI QC Approval stamp
 *      ("Quality Checked by {member}" + the canonical DesignID). The stamp
 *      shows in the UI AND on the 3D proof.
 *   5. Send to WrapBox → assembles every relevant asset (2D proof, 3D proofs,
 *      the dimensioned panel page, each per-side file named by side + dims, and
 *      the Logo Pack when purchased) and delivers to the customer's WrapBox.
 *
 * Read-only over the vault — never re-slices. Renders nothing until the paid
 * worker has produced print files (concept_json.print_worker), so it only ever
 * appears on real production jobs.
 */

const SIDE_LABEL: Record<string, string> = {
  driver_side: "Driver Side",
  passenger_side: "Passenger Side",
  hood: "Hood",
  roof: "Roof",
  front: "Front",
  rear: "Rear",
};

// 3D render view keys (color_visualizations.render_urls) → readable labels.
const VIEW_LABEL: Record<string, string> = {
  side: "Driver Side",
  "passenger-side": "Passenger Side",
  hood_detail: "Hood",
  front: "Front",
  rear: "Rear",
  "close-up": "Close-Up",
  roof: "Roof",
};
const VIEW_ORDER = ["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"];

function publicUrl(path?: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from("wrap-files").getPublicUrl(path).data?.publicUrl || null;
}

export function ProductionPackQCCard({ job, generationId }: { job?: { id: string; order_number?: string } | null; generationId?: string | null }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [approving, setApproving] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [durableApproval, setDurableApproval] = useState(false);
  // Local preview of the freshly-drawn stamp + the stamped hero 3D proof, so the
  // team sees the result immediately (and on camera) before/after delivery.
  const [stampPreview, setStampPreview] = useState<{ stampUrl: string; stampedProofUrl: string | null } | null>(null);

  const { data: pw } = useQuery({
    queryKey: ["production-pack-qc", job?.id ?? generationId ?? "none"],
    enabled: !!(job?.id || generationId),
    queryFn: async () => {
      let row: any = null;
      if (job?.id) {
        const { data, error } = await (supabase as any)
          .from("panelizer_jobs")
          .select("id, order_number, status, concept_json, generation_id")
          .eq("id", job.id)
          .maybeSingle();
        if (error) throw error;
        row = data;
      } else {
        const { data, error } = await (supabase as any)
          .from("panelizer_jobs")
          .select("id, order_number, status, concept_json, generation_id")
          .eq("generation_id", generationId)
          .order("created_at", { ascending: false })
          .limit(1);
        if (error) throw error;
        row = data?.[0] || null;
      }
      const p = row?.concept_json?.print_worker || null;

      let views3d: Record<string, string> = {};
      let proof2d: string | null = row?.concept_json?.flat_proof_url || null;
      let designName = row?.concept_json?.design_name || "";
      let logoPackCutfiles: { zip_url: string; count?: number } | null = null;
      let vehicle = { year: "", make: "", model: "" };
      const gid = row?.generation_id || generationId || null;
      let canonicalGid: string | null = gid;
      let existingStamp = row?.concept_json?.qc_stamp || null;
      if (gid) {
        try {
          const { data: cv } = await (supabase as any)
            .from("color_visualizations")
            .select("render_urls, admin_notes, vehicle_year, vehicle_make, vehicle_model, design_file_name, color_name")
            .eq("id", gid)
            .maybeSingle();
          if (cv?.render_urls && typeof cv.render_urls === "object") {
            for (const [k, v] of Object.entries(cv.render_urls)) {
              if (typeof v === "string" && v) views3d[k] = v;
            }
          }
          vehicle = {
            year: cv?.vehicle_year ? String(cv.vehicle_year) : "",
            make: cv?.vehicle_make || "",
            model: cv?.vehicle_model || "",
          };
          if (!designName) designName = cv?.design_file_name || cv?.color_name || "";
          const n = parseAdminNotes(cv?.admin_notes);
          if (n?.designiq_generation_id) canonicalGid = String(n.designiq_generation_id);
          if (!proof2d && typeof n?.flat_proof_url === "string") proof2d = n.flat_proof_url;
          if (n?.logo_pack_cutfiles && typeof n.logo_pack_cutfiles.zip_url === "string") {
            logoPackCutfiles = { zip_url: n.logo_pack_cutfiles.zip_url, count: n.logo_pack_cutfiles.count };
          }
        } catch { /* evidence stays empty */ }
        if (!proof2d) {
          try {
            const { data: dg } = await (supabase as any)
              .from("designiq_generations")
              .select("flat_proof_url, master_artboard_url, render_urls")
              .eq("id", canonicalGid || gid)
              .maybeSingle();
            proof2d = dg?.flat_proof_url || null;
            if (!Object.keys(views3d).length && dg?.render_urls && typeof dg.render_urls === "object") {
              for (const [k, v] of Object.entries(dg.render_urls)) {
                if (typeof v === "string" && v) views3d[k] = v;
              }
            }
          } catch { /* none */ }
        }
      }

      // The durable Production Pack workflow is the approval authority. The
      // PanelPro card reads it instead of treating cached concept JSON as proof
      // that QC completed.
      let durableProductionJob: any = null;
      let durableWorkflowRun: any = null;
      try {
        const { data: durable, error: durableError } = await supabase.functions.invoke(
          "run-production-flow",
          {
            body: {
              mode: "designpro_job",
              action: "status",
              panelizerJobId: row?.id,
            },
          },
        );
        if (!durableError && !(durable as any)?.error) {
          durableProductionJob = (durable as any)?.productionJob || null;
          durableWorkflowRun = (durable as any)?.workflowRun || null;
          const approvedStamp = durableWorkflowRun?.results?.approval?.details?.stamp;
          if (!existingStamp && approvedStamp?.stamp_url) existingStamp = approvedStamp;
        }
      } catch { /* approval evidence remains unavailable and QC fails closed */ }

      // ACTIVE ENTICE PACK — the QC is pinned to it. Panels built against a
      // superseded pack (a design revised after the pack was built) must never
      // pass QC or ship — that's the old-panel guard. We compare the pack id the
      // worker stamped onto print_worker against the CURRENT active pack.
      let activePackId: string | null = null;
      let activeLogoArtifacts: any[] = [];
      if (canonicalGid) {
        try {
          const { data: ap } = await (supabase as any)
            .from("designpro_entice_packs")
            .select("id,status,activated_at,logo_artifacts")
            .eq("designiq_generation_id", canonicalGid)
            .eq("status", "active")
            .order("activated_at", { ascending: false, nullsFirst: false })
            .limit(1)
            .maybeSingle();
          activePackId = ap?.id ? String(ap.id) : null;
          if (Array.isArray(ap?.logo_artifacts)) activeLogoArtifacts = ap.logo_artifacts;
        } catch { /* no pack row / no access — skip the guard rather than false-block */ }
      }

      return {
        jobId: row?.id as string | null,
        orderNumber: row?.order_number as string | null,
        status: row?.status as string | null,
        printWorker: p,
        generationId: canonicalGid as string | null,
        qcChecklist: (row?.concept_json?.qc_checklist || {}) as Record<string, { checked: boolean; at?: string }>,
        conceptJson: row?.concept_json || {},
        views3d,
        proof2dUrl: proof2d,
        designName,
        logoPackCutfiles,
        vehicle,
        existingStamp,
        activePackId,
        activeLogoArtifacts,
        durableApproved:
          durableProductionJob?.state === "complete" &&
          durableWorkflowRun?.workflow_status === "completed" &&
          durableWorkflowRun?.results?.approval?.status === "approved" &&
          durableWorkflowRun?.results?.approval?.details?.qc?.known === true &&
          durableWorkflowRun?.results?.approval?.details?.qc?.pass === true,
        durableAwaitingQc:
          durableProductionJob?.state === "awaiting_admin_qc" &&
          durableWorkflowRun?.workflow_status === "approval_required",
      };
    },
    refetchOnMount: "always",
    refetchInterval: (query) => {
      const d = query.state.data as any;
      const p = d?.printWorker;
      const inFlight = p?.activated?.length && !p?.zip;
      const waitingForDurableGate =
        !!p?.zip && !d?.durableAwaitingQc && !d?.durableApproved && d?.status !== "ready";
      return inFlight || waitingForDurableGate ? 12_000 : false;
    },
  });

  if (!pw?.printWorker || !pw?.jobId) return null;
  const p = pw.printWorker;
  const resolvedJob = { id: pw.jobId as string, order_number: pw.orderNumber || undefined };
  const activated: string[] = Array.isArray(p.activated) ? p.activated : [];
  const panels: Record<string, any> = p.panels || {};
  const zip = p.zip || null;
  const validation = p.validation || null;
  const delivered = pw.status === "delivered" || pw.status === "ready";
  const doneCount = activated.filter((k) => panels[k]).length;
  const did = formatDid(pw.generationId) || formatDid(resolvedJob.id) || "DID-————";
  // OLD-PANEL GUARD. The worker stamps which entice pack each panel came from.
  // If the design has since been revised (a newer active pack exists), these
  // print files are stale — they must never pass QC or ship to the customer.
  const pwPackId = p?.entice_pack_id ? String(p.entice_pack_id) : null;
  const pwRunKey = p?.run_key ? String(p.run_key) : null;
  const stalePanels = !pw.activePackId || !pwPackId || pw.activePackId !== pwPackId;

  // Ordered 3D proof views actually present.
  const proofViews = VIEW_ORDER
    .filter((k) => pw.views3d[k])
    .map((k) => ({ key: k, url: pw.views3d[k], label: VIEW_LABEL[k] || k }));
  const heroProof = proofViews.find((v) => v.key === "side") || proofViews.find((v) => v.key === "close-up") || proofViews[0] || null;

  const REQUIRED_SIDES = ["driver_side", "passenger_side", "hood", "roof", "front", "rear"];
  const mainSides = REQUIRED_SIDES.filter((k) => panels[k]);
  const missingSides = REQUIRED_SIDES.filter((k) => !panels[k]);
  // Clean (blank) panel outputs, from the worker's own activation manifest —
  // a side with a reasoned separation gap dispatches no clean job, so the
  // expected set is exactly what was activated, never a hardcoded six.
  const cleanKeys = activated.filter((k) => k.endsWith("_clean"));
  const cleanDone = cleanKeys.filter((k) => panels[k]);
  const packLogos: any[] = Array.isArray((pw as any).activeLogoArtifacts) ? (pw as any).activeLogoArtifacts : [];
  const hasPrintRes = REQUIRED_SIDES.every((k) => {
    const side = panels[k];
    const artifacts = Array.isArray(side?.artifacts) ? side.artifacts : [];
    const kinds = new Set(
      artifacts
        .filter((item: any) => item?.path && item?.bytes > 0 && /^[a-f0-9]{64}$/i.test(String(item?.sha256 || "")))
        .map((item: any) => item.kind),
    );
    return !!(
      side?.tiffPath && side?.pngPath && side?.previewPath && side?.epsPath &&
      kinds.has("tiff") && kinds.has("png") && kinds.has("preview") && kinds.has("eps")
    );
  });
  const checklist = pw.qcChecklist || {};

  // ── The QC steps, in the order the team runs them. Every tick persists to
  // concept_json.qc_checklist (auditable). "fit:{side}" checks are per-side. ──
  const dimsCheck = { key: "dims_validated", label: "Dimensions match the 2D production proof", ok: !!pw.proof2dUrl };
  const perSideFit = mainSides.map((k) => ({ key: `fit:${k}`, side: k }));
  const finalChecks: Array<{ key: string; label: string; evidence: string; ok: boolean }> = [
    {
      key: "file_resolution",
      label: "Print resolution verified (1500-DPI CMYK TIFF)",
      evidence: hasPrintRes ? "6/6 TIFF, PNG, preview and EPS files have byte hashes" : "one or more required print artifacts/hashes are missing",
      ok: hasPrintRes,
    },
    {
      key: "proofs_3d",
      label: "3D proofs present and match the approved design",
      evidence: proofViews.length === VIEW_ORDER.length ? "7/7 approved view renders on file" : `${proofViews.length}/7 approved view renders on file`,
      ok: proofViews.length === VIEW_ORDER.length,
    },
    {
      key: "all_sides_present",
      label: "All panel files present: driver · passenger · hood · roof · front · rear",
      evidence: missingSides.length ? `MISSING: ${missingSides.map((k) => SIDE_LABEL[k] || k).join(", ")}` : "6/6 side files present",
      ok: missingSides.length === 0,
    },
    // The owner's contract covers the WHOLE pack, not just the six branded
    // sides: the blank (clean) panels the team lays on vehicle templates and
    // the separated logo assets are deliverables too, and QC used to ignore
    // both. Clean keys come from the worker's own dispatch manifest (gap sides
    // legitimately have none), logos from the verified active pack.
    {
      key: "clean_and_logo_assets",
      label: "Blank (clean) panels and separated logo assets reviewed",
      evidence: `${cleanDone.length}/${cleanKeys.length} clean panel print file(s) present · ${packLogos.length} logo asset(s) on the verified pack`,
      ok: cleanDone.length === cleanKeys.length,
    },
  ];

  const allFits = perSideFit.length > 0 && perSideFit.every((f) => checklist[f.key]?.checked);
  const allFinal = finalChecks.every((c) => checklist[c.key]?.checked);
  const dimsOk = !!checklist[dimsCheck.key]?.checked;
  const readyToStamp =
    dimsCheck.ok && dimsOk && allFits && allFinal &&
    finalChecks.every((check) => check.ok) && !stalePanels && pw.durableAwaitingQc;
  const approved = pw.durableApproved || durableApproval;
  const stamped = approved && (!!pw.existingStamp?.stamped_at || !!stampPreview);

  const toggleCheck = async (key: string) => {
    if (delivered) return;
    const next = {
      ...(pw.conceptJson?.qc_checklist || {}),
      [key]: { checked: !checklist[key]?.checked, at: new Date().toISOString() },
    };
    try {
      const { error } = await (supabase as any)
        .from("panelizer_jobs")
        .update({ concept_json: { ...(pw.conceptJson || {}), qc_checklist: next } })
        .eq("id", resolvedJob.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["production-pack-qc", job?.id ?? generationId ?? "none"] });
    } catch (e: any) {
      toast({ title: "Could not save check", description: e?.message || "Try again", variant: "destructive" });
    }
  };

  // ── FRESH branded DesignProAI QC Approval stamp — a transparent-background
  // round seal, pure canvas, deterministic. Not the old certificate: this is a
  // stamp that reads on camera and overlays onto the 3D proof. ──
  const drawStampSeal = (x: CanvasRenderingContext2D, cx: number, cy: number, r: number, verifiedBy: string) => {
    x.save();
    // Double ring
    x.strokeStyle = "#059669"; x.lineWidth = r * 0.05;
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.stroke();
    x.lineWidth = r * 0.018;
    x.beginPath(); x.arc(cx, cy, r * 0.86, 0, Math.PI * 2); x.stroke();
    // Curved top text: DESIGNPROAI · QUALITY CONTROL
    const top = "DESIGNPROAI  ·  QUALITY CONTROL";
    x.fillStyle = "#059669"; x.textAlign = "center"; x.textBaseline = "middle";
    x.font = `bold ${Math.round(r * 0.11)}px Arial`;
    const arc = Math.PI * 0.9; // spread across the top
    const start = -Math.PI / 2 - arc / 2;
    for (let i = 0; i < top.length; i++) {
      const t = top.length > 1 ? i / (top.length - 1) : 0.5;
      const a = start + arc * t;
      x.save();
      x.translate(cx + Math.cos(a) * r * 0.93, cy + Math.sin(a) * r * 0.93);
      x.rotate(a + Math.PI / 2);
      x.fillText(top[i], 0, 0);
      x.restore();
    }
    // Center block
    x.fillStyle = "#065f46"; x.font = `bold ${Math.round(r * 0.13)}px Arial`;
    x.fillText("QUALITY", cx, cy - r * 0.28);
    x.fillStyle = "#059669"; x.font = `bold ${Math.round(r * 0.22)}px Arial`;
    x.fillText("APPROVED", cx, cy - r * 0.05);
    // star divider
    x.font = `${Math.round(r * 0.12)}px Arial`; x.fillStyle = "#10b981";
    x.fillText("★ ★ ★", cx, cy + r * 0.16);
    // Checked-by + DID + date
    x.fillStyle = "#065f46"; x.font = `bold ${Math.round(r * 0.085)}px Arial`;
    x.fillText(`Quality Checked by ${verifiedBy}`.slice(0, 42), cx, cy + r * 0.36);
    x.font = `${Math.round(r * 0.09)}px Arial`;
    x.fillText(did, cx, cy + r * 0.5);
    x.fillStyle = "#6b7280"; x.font = `${Math.round(r * 0.07)}px Arial`;
    x.fillText(new Date().toLocaleDateString(), cx, cy + r * 0.62);
    x.restore();
  };

  const buildStampBlob = async (verifiedBy: string): Promise<Blob> => {
    const S = 720;
    const c = document.createElement("canvas");
    c.width = S; c.height = S;
    const x = c.getContext("2d")!;
    drawStampSeal(x, S / 2, S / 2, S / 2 - 12, verifiedBy);
    return new Promise((resolve, reject) =>
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("stamp render failed"))), "image/png"));
  };

  // Composite the stamp onto the hero 3D proof so the team can show a STAMPED 3D
  // proof (in the app, in videos, and in ads). Best-effort: if the image can't be
  // read cross-origin we still deliver the proof + the stamp separately.
  const buildStampedProof = async (proofUrl: string, verifiedBy: string): Promise<Blob | null> => {
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.crossOrigin = "anonymous";
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error("proof image load failed"));
        im.src = proofUrl;
      });
      const c = document.createElement("canvas");
      c.width = img.naturalWidth || 1600;
      c.height = img.naturalHeight || 900;
      const x = c.getContext("2d")!;
      x.drawImage(img, 0, 0, c.width, c.height);
      const r = Math.round(Math.min(c.width, c.height) * 0.19);
      const cx = c.width - r - Math.round(c.width * 0.03);
      const cy = c.height - r - Math.round(c.height * 0.04);
      // Soft plate behind the seal for legibility on busy renders.
      x.save();
      x.globalAlpha = 0.82; x.fillStyle = "#ffffff";
      x.beginPath(); x.arc(cx, cy, r * 1.03, 0, Math.PI * 2); x.fill();
      x.restore();
      drawStampSeal(x, cx, cy, r, verifiedBy);
      return await new Promise<Blob | null>((resolve) => c.toBlob((b) => resolve(b), "image/png"));
    } catch (e) {
      console.warn("[QC] stamped-proof composite skipped:", e);
      return null;
    }
  };

  const uploadPng = async (blob: Blob, name: string): Promise<string> => {
    const path = `wrapbox/${resolvedJob.order_number || resolvedJob.id}/${name}`;
    const { error } = await supabase.storage.from("wrap-files").upload(path, blob, { contentType: "image/png", upsert: true });
    if (error) throw new Error(`QC artifact upload failed: ${error.message}`);
    return supabase.storage.from("wrap-files").getPublicUrl(path).data.publicUrl;
  };

  const buildDeliveryFiles = (stamp: { stamp_url: string; stamped_proof_url: string | null }) => {
    const nameFor = (side: string) => {
      const s = panels[side];
      const dims = s?.width_in && s?.height_in ? `_${Math.round(s.width_in)}x${Math.round(s.height_in)}in` : "";
      return `${SIDE_LABEL[side] || side}${dims}`.replace(/\s+/g, "-");
    };
    const files: Array<{ url: string; label: string; kind: string }> = [];
    if (pw.proof2dUrl) files.push({ url: pw.proof2dUrl, label: "2D-Production-Proof", kind: "proof_2d" });
    if (stamp.stamped_proof_url) files.push({ url: stamp.stamped_proof_url, label: "3D-Proof-Stamped", kind: "proof_3d" });
    for (const view of proofViews) files.push({ url: view.url, label: `3D-Proof-${view.label}`, kind: "proof_3d" });
    for (const side of REQUIRED_SIDES) {
      const item = panels[side];
      const tiff = publicUrl(item?.tiffPath);
      const png = publicUrl(item?.pngPath);
      const eps = publicUrl(item?.epsPath);
      if (tiff) files.push({ url: tiff, label: `${nameFor(side)}-TIFF`, kind: "panel" });
      if (png) files.push({ url: png, label: `${nameFor(side)}-PNG`, kind: "panel" });
      if (eps) files.push({ url: eps, label: `${nameFor(side)}-EPS`, kind: "vector" });
    }
    // Blank (clean) panel print files — same TIFF/PNG/EPS trio, delivered so
    // the shop can lay logo-free panels on templates. Only the sides that
    // actually dispatched a clean job (gap sides honestly have none).
    for (const key of cleanKeys) {
      const item = panels[key];
      const side = key.replace(/_clean$/, "");
      const tiff = publicUrl(item?.tiffPath);
      const png = publicUrl(item?.pngPath);
      const eps = publicUrl(item?.epsPath);
      if (tiff) files.push({ url: tiff, label: `${nameFor(side)}-Blank-TIFF`, kind: "panel" });
      if (png) files.push({ url: png, label: `${nameFor(side)}-Blank-PNG`, kind: "panel" });
      if (eps) files.push({ url: eps, label: `${nameFor(side)}-Blank-EPS`, kind: "vector" });
    }
    // Separated logo assets from the verified active pack (`url` is the
    // plotter-ready cut asset; the legacy cutfiles zip stays alongside).
    for (const [i, l] of packLogos.entries()) {
      const cut = String((l as any)?.url || (l as any)?.cut_url || "");
      if (!cut) continue;
      const slug = String((l as any)?.label || `logo-${i + 1}`).replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 40);
      files.push({ url: cut, label: `Logo-${i + 1}-${slug}`, kind: "logo_pack" });
    }
    if (pw.logoPackCutfiles?.zip_url) {
      files.push({ url: pw.logoPackCutfiles.zip_url, label: "Logo-Pack-Cut-Files", kind: "logo_pack" });
    }
    files.push({ url: stamp.stamp_url, label: "QC-Approval-Stamp", kind: "qc_certificate" });
    return files;
  };

  // ── STEP 4: Approve → draw + persist the stamp; render it in the UI + on 3D proof. ──
  const approve = async () => {
    if (!readyToStamp || approving) return;
    setApproving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const verifiedBy = auth?.user?.email?.split("@")[0] || "design team";
      const stampBlob = await buildStampBlob(verifiedBy);
      const stampUrl = await uploadPng(stampBlob, "qc-approval-stamp.png");
      let stampedProofUrl: string | null = null;
      if (heroProof) {
        const composited = await buildStampedProof(heroProof.url, verifiedBy);
        if (composited) stampedProofUrl = await uploadPng(composited, "qc-stamped-3d-proof.png");
      }
      const stamp = {
        stamped_at: new Date().toISOString(),
        stamped_by: verifiedBy,
        did,
        stamp_url: stampUrl,
        stamped_proof_url: stampedProofUrl,
      };
      const deliveryFiles = buildDeliveryFiles(stamp);
      const approvalRef = [
        "panelpro-qc",
        resolvedJob.id,
        String(p?.run_key || "no-run"),
        String(p?.zip?.sha256 || "no-zip"),
      ].join(":");
      const { data: approvalData, error: approvalError } = await supabase.functions.invoke(
        "run-production-flow",
        {
          body: {
            mode: "designpro_job",
            action: "approve",
            panelizerJobId: resolvedJob.id,
            approvalRef,
            details: {
              qc: {
                known: true,
                pass: true,
                checklist,
                requiredSides: REQUIRED_SIDES,
                approvedViewCount: proofViews.length,
                printArtifactsVerified: hasPrintRes,
                sourceHash: p?.source_hash || null,
                packVersion: p?.pack_version || null,
                runKey: p?.run_key || null,
                zipSha256: p?.zip?.sha256 || null,
              },
              stamp,
              deliveryFiles,
            },
          },
        },
      );
      if (approvalError) throw approvalError;
      if ((approvalData as any)?.success !== true || (approvalData as any)?.error) {
        throw new Error((approvalData as any)?.error || "Durable Production Pack approval failed");
      }
      setDurableApproval(true);
      setStampPreview({ stampUrl, stampedProofUrl });
      queryClient.invalidateQueries({ queryKey: ["production-pack-qc", job?.id ?? generationId ?? "none"] });
      toast({ title: "QC Approved & stamped", description: `Quality Checked by ${verifiedBy} · ${did}. Stamp now shows on the 3D proof.` });
    } catch (e: any) {
      toast({ title: "Stamp failed", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setApproving(false);
    }
  };

  // ── STEP 5: deliver the exact asset list frozen by durable QC approval. ──
  const sendToWrapbox = async () => {
    if (shipping || !approved) return;
    setShipping(true);
    try {
      const { data, error } = await supabase.functions.invoke("deploy-to-wrapbox", {
        body: { job_id: resolvedJob.id },
      });
      if (error) throw error;
      if ((data as any)?.success === false || (data as any)?.error) throw new Error((data as any).error || "Deploy failed");
      toast({
        title: "Delivered to WrapBox",
        description: `${(data as any)?.fileCount ?? 0} approved asset(s)${(data as any)?.productionPackZip ? " + production-pack ZIP" : ""} sent — customer ${(data as any)?.notified ? "emailed" : "not emailed"}. GENIE now shows complete.`,
      });
      queryClient.invalidateQueries({ queryKey: ["production-pack-qc", job?.id ?? generationId ?? "none"] });
    } catch (e: any) {
      toast({ title: "WrapBox delivery failed", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setShipping(false);
    }
  };

  const stampImg = stampPreview?.stampUrl || pw.existingStamp?.stamp_url || null;
  const stampedProofImg = stampPreview?.stampedProofUrl || pw.existingStamp?.stamped_proof_url || null;

  const StepBadge = ({ n, done }: { n: number; done: boolean }) => (
    <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${done ? "bg-emerald-600 text-white" : "bg-gray-200 text-gray-600"}`}>
      {done ? <Check className="h-3.5 w-3.5" /> : n}
    </span>
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-blue-600" />
          <span className="text-sm font-bold text-gray-900">DesignProAI™ — Human Quality Control</span>
          <span className="text-[11px] font-mono text-gray-500">{did}</span>
          <span className="text-[11px] text-gray-400">· {resolvedJob.order_number || resolvedJob.id.slice(0, 8)}</span>
          {pwRunKey && <span className="text-[10px] font-mono text-gray-400">· run {pwRunKey.slice(0, 8)}</span>}
        </div>
        {delivered ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
            <BadgeCheck className="h-3.5 w-3.5" /> QC passed · delivered to WrapBox
          </span>
        ) : stamped ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold text-blue-700">
            <Stamp className="h-3.5 w-3.5" /> Stamped — ready to send
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700">
            Awaiting designer QC
          </span>
        )}
      </div>

      {stalePanels && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3">
          <p className="text-[12px] font-bold text-red-700 flex items-center gap-1.5">
            <X className="h-3.5 w-3.5" /> These print files are not bound to the current active design pack
          </p>
          <p className="mt-1 text-[11px] text-red-700/90 leading-snug">
            PanelPro could not prove that these files belong to the current active pack
            (<span className="font-mono">{pwPackId?.slice(0, 8)}</span> vs current
            {" "}<span className="font-mono">{pw.activePackId?.slice(0, 8)}</span>). QC and delivery are
            blocked to stop old panels shipping — re-order the Production Pack to rebuild against the
            current design, then QC the fresh files.
          </p>
        </div>
      )}

      {/* STEP 1 — validate dims against the 2D production proof */}
      <section className="rounded-lg border border-gray-100 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <StepBadge n={1} done={dimsOk} />
          <span className="text-xs font-semibold text-gray-800 flex items-center gap-1.5"><Ruler className="h-3.5 w-3.5 text-blue-600" /> Validate dimensions against the 2D proof</span>
        </div>
        {pw.proof2dUrl ? (
          <a href={pw.proof2dUrl} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-md border border-gray-200 bg-white hover:border-blue-400" title="Open the dimensioned 2D production proof full size">
            <img src={pw.proof2dUrl} alt="2D Production Proof" className="w-full max-h-72 object-contain" loading="lazy" />
          </a>
        ) : (
          <p className="text-[11px] text-amber-700 font-semibold">No 2D production proof on file — investigate before approving.</p>
        )}
        <label className={`flex items-center gap-2 rounded border px-2 py-1.5 cursor-pointer ${dimsOk ? "border-emerald-200 bg-emerald-50/50" : "border-gray-200 hover:bg-gray-50"}`}>
          <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={dimsOk} disabled={delivered || !dimsCheck.ok} onChange={() => toggleCheck(dimsCheck.key)} />
          <span className="text-[12px] font-semibold text-gray-800">{dimsCheck.label}</span>
        </label>
      </section>

      {/* STEP 2 — download hi-res panels, lay on the vehicle template, check fit per side */}
      <section className="rounded-lg border border-gray-100 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <StepBadge n={2} done={allFits} />
          <span className="text-xs font-semibold text-gray-800 flex items-center gap-1.5"><Layers className="h-3.5 w-3.5 text-indigo-600" /> Download hi-res panels &amp; fit on the vehicle template</span>
          <span className="ml-auto text-[10px] text-gray-500">{doneCount}/{activated.length} sides printed</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {activated.map((k) => {
            const s = panels[k];
            const tiff = publicUrl(s?.tiffPath);
            const png = publicUrl(s?.pngPath);
            const eps = publicUrl(s?.epsPath);
            const fitKey = `fit:${k}`;
            const fit = !!checklist[fitKey]?.checked;
            return (
              <div key={k} className={`rounded border px-2 py-1.5 text-[11px] ${fit ? "border-emerald-300 bg-emerald-50/60" : s ? "border-gray-200 bg-white" : "border-gray-200 bg-gray-50"}`}>
                <div className="flex items-center gap-1 font-semibold text-gray-800">
                  {s ? <Check className="h-3 w-3 text-emerald-600" /> : <Loader2 className="h-3 w-3 animate-spin text-gray-400" />}
                  {SIDE_LABEL[k] || k}
                  {s?.width_in ? <span className="font-normal text-gray-500">· {Math.round(s.width_in)}″×{Math.round(s.height_in)}″</span> : null}
                </div>
                {s && (
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="flex gap-2">
                      {tiff && <a className="text-blue-600 hover:underline" href={tiff} target="_blank" rel="noopener noreferrer">TIFF</a>}
                      {png && <a className="text-blue-600 hover:underline" href={png} target="_blank" rel="noopener noreferrer">PNG</a>}
                      {eps && <a className="text-blue-600 hover:underline" href={eps} target="_blank" rel="noopener noreferrer">EPS</a>}
                    </span>
                    <label className="flex items-center gap-1 cursor-pointer text-gray-700">
                      <input type="checkbox" className="h-3.5 w-3.5 accent-emerald-600" checked={fit} disabled={delivered} onChange={() => toggleCheck(fitKey)} />
                      fits template
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {zip?.url && (
          <a href={zip.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:underline">
            <Download className="h-3.5 w-3.5" /> all panels ZIP · {zip.file_count} files{zip.size ? ` · ${(zip.size / 1024 / 1024).toFixed(0)} MB` : ""}
          </a>
        )}
      </section>

      {/* STEP 3 — final quality checks */}
      <section className="rounded-lg border border-gray-100 p-3 space-y-1.5">
        <div className="flex items-center gap-2">
          <StepBadge n={3} done={allFinal} />
          <span className="text-xs font-semibold text-gray-800 flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-indigo-600" /> Final quality checks</span>
          {validation && (
            <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${validation.pass ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
              {validation.pass ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />} {validation.pass ? "Regression PASS" : "Regression FAIL"}
            </span>
          )}
        </div>
        {finalChecks.map((c) => (
          <label key={c.key} className={`flex items-start gap-2 rounded border px-2 py-1.5 cursor-pointer ${checklist[c.key]?.checked ? "border-emerald-200 bg-emerald-50/50" : c.ok ? "border-gray-200 bg-white hover:bg-gray-50" : "border-amber-300 bg-amber-50/50"}`}>
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-emerald-600" checked={!!checklist[c.key]?.checked} disabled={delivered || !c.ok} onChange={() => toggleCheck(c.key)} />
            <span className="min-w-0">
              <span className="block text-[12px] font-semibold text-gray-800">{c.label}</span>
              <span className={`block text-[10.5px] ${c.ok ? "text-gray-500" : "text-amber-700 font-semibold"}`}>{c.evidence}</span>
            </span>
          </label>
        ))}
      </section>

      {/* STEP 4 — approve → stamp. Shows the stamp + the stamped 3D proof. */}
      <section className="rounded-lg border border-gray-100 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <StepBadge n={4} done={stamped} />
          <span className="text-xs font-semibold text-gray-800 flex items-center gap-1.5"><Stamp className="h-3.5 w-3.5 text-emerald-600" /> Approve &amp; apply the DesignProAI QC stamp</span>
        </div>
        {stamped ? (
          <div className="grid grid-cols-1 sm:grid-cols-[auto,1fr] gap-3 items-center">
            {stampImg && (
              <img src={stampImg} alt="DesignProAI QC Approval stamp" className="h-28 w-28 object-contain" />
            )}
            <div className="relative overflow-hidden rounded-md border border-gray-200 bg-gray-900">
              {(stampedProofImg || heroProof) && (
                <img src={stampedProofImg || heroProof!.url} alt="Stamped 3D proof" className="w-full max-h-56 object-contain" />
              )}
              {!stampedProofImg && heroProof && stampImg && (
                // CSS overlay fallback — always visible even if the composite was skipped.
                <img src={stampImg} alt="QC stamp" className="absolute bottom-2 right-2 h-20 w-20 object-contain drop-shadow" />
              )}
              <span className="absolute top-2 left-2 rounded bg-emerald-600/90 px-2 py-0.5 text-[10px] font-bold text-white">Stamped 3D Proof</span>
            </div>
          </div>
        ) : (
          <Button
            className="w-full gap-1.5 bg-gradient-to-r from-blue-600 to-fuchsia-600 text-white hover:brightness-110 disabled:opacity-60"
            disabled={approving || delivered || !readyToStamp}
            onClick={approve}
            title={readyToStamp ? "Draw the QC approval stamp and apply it to the 3D proof" : "Complete steps 1–3 first"}
          >
            {approving ? <><Loader2 className="h-4 w-4 animate-spin" /> Stamping…</> : <><Stamp className="h-4 w-4" /> Approve &amp; Stamp — Quality Checked</>}
          </Button>
        )}
      </section>

      {/* STEP 5 — send to WrapBox */}
      <section className="rounded-lg border border-gray-100 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <StepBadge n={5} done={delivered} />
          <span className="text-xs font-semibold text-gray-800 flex items-center gap-1.5"><FileText className="h-3.5 w-3.5 text-emerald-600" /> Send every asset to WrapBox</span>
        </div>
        <p className="text-[10.5px] text-gray-500 leading-snug">
          Delivers the 2D proof, {proofViews.length} 3D proof{proofViews.length === 1 ? "" : "s"} (stamped), the dimensioned panel page, {mainSides.length} per-side print file{mainSides.length === 1 ? "" : "s"} named by side + dims{pw.logoPackCutfiles?.zip_url ? ", and the purchased Logo Pack cut files" : " (no Logo Pack on this design)"} — plus the QC stamp.
        </p>
        <Button
          className="w-full gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-500 text-white hover:brightness-110 disabled:opacity-60"
            disabled={shipping || delivered || !stamped || !approved || stalePanels}
          onClick={sendToWrapbox}
          title={stalePanels ? "Blocked — panels are from an older design version; re-order the pack" : approved && stamped ? "Deliver the exact durably approved asset set to the customer's WrapBox" : "Complete durable QC approval first"}
        >
          {shipping ? <><Loader2 className="h-4 w-4 animate-spin" /> Delivering to WrapBox…</>
            : delivered ? <><Check className="h-4 w-4" /> Delivered to WrapBox</>
            : <><Package className="h-4 w-4" /> Approve &amp; Send to WrapBox</>}
        </Button>
      </section>
    </div>
  );
}

export default ProductionPackQCCard;
