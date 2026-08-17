/**
 * deploy-to-wrapbox
 *
 * Final step of the 48-hour production sequence. When the human designer has
 * finished the wrap design panel + extracted elements (and uploaded their
 * finished Illustrator output), this delivers everything into the CUSTOMER's
 * WrapBox and notifies them.
 *
 * It writes a `production_packs` row scoped to the customer's shop_id
 * (= shop_profiles.id of the job owner), with a WrapboxManifest in
 * panels_selected — the exact shape the customer's WrapBox page reads. Files
 * are copied into wrap-files/wrapbox/{order_number}/. Then it emails the
 * customer a link to their WrapBox.
 *
 * Runs with the service role so it can write a pack under another user's shop
 * (the designer is an admin, not the pack owner) without tripping RLS.
 *
 * Input:  { job_id: string }
 * Output: { success, packId, fileCount, notified }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "wrap-files";
const VECTOR_EXTS = new Set(["eps", "ai", "pdf", "svg"]);

interface WrapboxElement {
  id: string;
  // The DesignProAI QC delivery ships a typed asset set so the customer's
  // WrapBox can group them: the 2D production proof, the 3D proofs (one carries
  // the QC stamp), each per-side print panel, the Logo Pack cut files, and the
  // QC approval stamp — alongside the legacy design_panel/element/background.
  kind:
    | "design_panel" | "element" | "background" | "vector"
    | "proof_2d" | "proof_3d" | "panel" | "logo_pack" | "qc_certificate";
  label: string;
  url: string;
  added_at: string;
  added_by?: string | null;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "file";
}

function extOf(nameOrUrl: string): string {
  const clean = nameOrUrl.split("?")[0];
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "";
}

async function copyIntoWrapbox(
  sb: any,
  orderNumber: string,
  sourceUrl: string,
  fileName: string,
): Promise<string> {
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`fetch source ${res.status} for ${sourceUrl.slice(0, 80)}`);
  const blob = await res.blob();
  const contentType = blob.type || "application/octet-stream";
  const path = `wrapbox/${orderNumber}/${fileName}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType, upsert: true });
  if (error) throw new Error(`wrapbox upload failed: ${error.message}`);
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ── Auth: require an authenticated designer ──
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "Authentication required" }, 401);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Authentication required" }, 401);
    const designerEmail = user.email ?? null;

    const { job_id } = await req.json();
    if (!job_id) return json({ error: "job_id is required" }, 400);

    const sb = createClient(supabaseUrl, serviceKey);
    const { data: operatorRole, error: roleError } = await sb
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .in("role", ["admin", "tester"])
      .limit(1)
      .maybeSingle();
    if (roleError) return json({ error: `Operator role lookup failed: ${roleError.message}` }, 500);
    if (!operatorRole) return json({ error: "Admin production QC permission required" }, 403);

    // ── Load job ──
    const { data: job, error: jobErr } = await sb
      .from("panelizer_jobs")
      // NOTE: panelizer_jobs has NO finish_type column — selecting it made EVERY
      // delivery fail at "Job lookup failed" (caught by the test-account run
      // 2026-07-24). Finish comes from concept_json only.
      .select("id, user_id, order_number, status, vehicle_year, vehicle_make, vehicle_model, approved_render_url, concept_json, generation_id")
      .eq("id", job_id)
      .maybeSingle();
    if (jobErr) return json({ error: `Job lookup failed: ${jobErr.message}` }, 500);
    if (!job) return json({ error: "Job not found" }, 404);
    if (!job.user_id) return json({ error: "Job has no customer (user_id)" }, 400);
    if (!job.order_number) return json({ error: "Job has no order_number" }, 400);

    const concept = (job.concept_json || {}) as Record<string, any>;

    // ── Durable admin-QC gate ──
    // Shipping is allowed only after the existing DesignPro production workflow
    // completed its await_admin_qc stage with known passing evidence. The exact
    // delivery file list was frozen into that approval; browser-supplied URLs
    // are never accepted here.
    const { data: productionJob, error: productionJobError } = await sb
      .from("designpro_production_jobs")
      .select("id,state,result")
      .eq("panelizer_job_id", job_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (productionJobError) return json({ error: `Production job lookup failed: ${productionJobError.message}` }, 500);
    if (!productionJob || productionJob.state !== "complete") {
      return json({ error: "Production Pack has not completed durable admin QC" }, 409);
    }
    const { data: workflowRun, error: workflowError } = await sb
      .from("workforce_runs")
      .select("id,workflow_status,results")
      .eq("workflow_type", "designpro.production_pack")
      .eq("domain_job_id", productionJob.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (workflowError) return json({ error: `Production workflow lookup failed: ${workflowError.message}` }, 500);
    const { data: approvalStage, error: approvalStageError } = workflowRun
      ? await sb
          .from("workflow_stage_runs")
          .select("status,verification")
          .eq("run_id", workflowRun.id)
          .eq("stage_key", "await_admin_qc")
          .eq("scope_key", "")
          .maybeSingle()
      : { data: null, error: null };
    if (approvalStageError) return json({ error: `Approval-stage lookup failed: ${approvalStageError.message}` }, 500);
    const approval = workflowRun?.results?.approval || null;
    const approvalDetails = approval?.details || null;
    const qc = approvalDetails?.qc || null;
    const approvalRef = String(approval?.approvalRef || "");
    const requiredSides = Array.isArray(qc?.requiredSides) ? [...qc.requiredSides].sort() : [];
    const expectedSides = ["driver_side", "front", "hood", "passenger_side", "rear", "roof"];
    if (
      workflowRun?.workflow_status !== "completed" ||
      approval?.status !== "approved" ||
      !approvalRef ||
      approvalStage?.status !== "completed" ||
      approvalStage?.verification?.verified !== true ||
      approvalStage?.verification?.kind !== "admin_production_qc" ||
      approvalStage?.verification?.qc?.known !== true ||
      approvalStage?.verification?.qc?.pass !== true ||
      qc?.known !== true ||
      qc?.pass !== true ||
      qc?.approvedViewCount !== 7 ||
      qc?.printArtifactsVerified !== true ||
      JSON.stringify(requiredSides) !== JSON.stringify(expectedSides) ||
      productionJob.result?.approval?.approvalRef !== approvalRef
    ) {
      return json({ error: "Durable DesignPro QC evidence is incomplete or stale" }, 409);
    }
    if (
      !["pending_qc", "ready"].includes(String(job.status || "")) ||
      (job.status === "ready" && concept.qc_data?.approval_ref !== approvalRef)
    ) {
      return json({ error: "PanelPro job is not the durably approved QC candidate" }, 409);
    }

    const approvedFinalFiles: Array<{ url: string; label?: string; kind?: string }> =
      Array.isArray(approvalDetails?.deliveryFiles)
        ? approvalDetails.deliveryFiles.filter((file: any) =>
            typeof file?.url === "string" && file.url.startsWith("https://") &&
            typeof file?.label === "string" && typeof file?.kind === "string")
        : [];
    if (!approvedFinalFiles.length || !approvedFinalFiles.some((file) => file.kind === "proof_2d")) {
      return json({ error: "Approved WrapBox asset manifest is missing" }, 409);
    }

    // The ZIP is the exact Railway artifact verified before approval. It cannot
    // be rebuilt or self-healed after the approval snapshot was signed.
    const printWorker = (concept.print_worker || {}) as Record<string, any>;
    const packZip: Record<string, any> | null = printWorker.zip || null;
    const printOutput = workflowRun?.results?.printOutput || null;
    if (
      !packZip?.url || !packZip?.path || !packZip?.sha256 ||
      String(printWorker.source_hash || "").toLowerCase() !== String(printOutput?.sourceHash || "").toLowerCase() ||
      String(printWorker.pack_version || "").toLowerCase() !== String(printOutput?.packVersion || "").toLowerCase() ||
      String(printWorker.run_key || "").toLowerCase() !== String(printOutput?.runKey || "").toLowerCase() ||
      packZip.path !== printOutput?.zip?.path ||
      packZip.url !== printOutput?.zip?.url ||
      String(packZip.sha256).toLowerCase() !== String(printOutput?.zip?.sha256 || "").toLowerCase() ||
      String(qc?.sourceHash || "").toLowerCase() !== String(printWorker.source_hash || "").toLowerCase() ||
      String(qc?.packVersion || "").toLowerCase() !== String(printWorker.pack_version || "").toLowerCase() ||
      String(qc?.runKey || "").toLowerCase() !== String(printWorker.run_key || "").toLowerCase() ||
      String(qc?.zipSha256 || "").toLowerCase() !== String(packZip.sha256).toLowerCase()
    ) {
      return json({ error: "Approved Railway output identity no longer matches PanelPro" }, 409);
    }

    // ── Resolve the customer's shop_id (shop_profiles.id where they are owner) ──
    const { data: shopRow, error: shopErr } = await sb
      .from("shop_profiles")
      .select("id")
      .eq("user_id", job.user_id)
      .maybeSingle();
    if (shopErr) return json({ error: `Shop lookup failed: ${shopErr.message}` }, 500);
    if (!shopRow?.id) {
      return json({ error: "Customer has no shop_profile — cannot place files in their WrapBox." }, 400);
    }
    const shopId = shopRow.id as string;

    // ── Assemble the files to deliver ──
    const designPanelUrl: string | null =
      approvedFinalFiles.find((file) => file.kind === "proof_2d")?.url || null;
    // De-dupe the durably approved asset snapshot by URL.
    const seen = new Set<string>();
    const finalFiles = approvedFinalFiles.filter((f) => {
      if (seen.has(f.url)) return false;
      seen.add(f.url);
      return true;
    });

    if (!designPanelUrl && finalFiles.length === 0 && !packZip) {
      return json({ error: "Nothing to deliver — no production pack, no design panel, and no final files uploaded." }, 400);
    }

    const orderNumber = job.order_number as string;
    const elements: WrapboxElement[] = [];
    const nowIso = new Date().toISOString();
    let thumbnailUrl: string | null = null;

    if (designPanelUrl) {
      const ext = extOf(designPanelUrl) || "png";
      const publicUrl = await copyIntoWrapbox(sb, orderNumber, designPanelUrl, `design-panel.${ext}`);
      thumbnailUrl = publicUrl;
      elements.push({
        id: crypto.randomUUID(),
        kind: "design_panel",
        label: "Design Panel",
        url: publicUrl,
        added_at: nowIso,
        added_by: designerEmail,
      });
    }

    let fileSeq = 0;
    for (const f of finalFiles) {
      if (!f?.url) continue;
      const label = f.label || "Final File";
      // The extension MUST come from the URL — QC labels are human names
      // ("2D-Production-Proof", "Driver-Side_196x50in") with no extension, so
      // reading it from the label would save every asset as `.bin`.
      const ext = extOf(f.url) || extOf(f.label || "") || "bin";
      const kind = (f.kind as WrapboxElement["kind"]) || (VECTOR_EXTS.has(ext) ? "vector" : "element");
      // A short sequence keeps each asset a clean, stable, human-named file
      // (driver-side-196x50in-03.tiff) rather than a Date.now() suffix.
      const fileName = `final/${slugify(label)}-${String(++fileSeq).padStart(2, "0")}.${ext}`;
      const publicUrl = await copyIntoWrapbox(sb, orderNumber, f.url, fileName);
      elements.push({
        id: crypto.randomUUID(),
        kind,
        label,
        url: publicUrl,
        added_at: nowIso,
        added_by: designerEmail,
      });
    }

    // ── Upsert the customer's production_packs row ──
    const designName = concept.design_name || `WrapBox Job ${orderNumber}`;
    const vehicleInfo = {
      year: job.vehicle_year ? String(job.vehicle_year) : "",
      make: job.vehicle_make || "",
      model: job.vehicle_model || "",
    };

    // Find an existing WrapBox pack for this job under the customer's shop.
    const { data: existingPacks, error: packLookupErr } = await sb
      .from("production_packs")
      .select("id, panels_selected")
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false });
    if (packLookupErr) return json({ error: `Pack lookup failed: ${packLookupErr.message}` }, 500);

    let packId: string | null = null;
    let existingManifest: any = null;
    for (const row of (existingPacks || []) as Array<{ id: string; panels_selected: any }>) {
      const m = row.panels_selected;
      if (m && m.wrapbox_kind === "qc_elements" && m.job_id === job_id) {
        packId = row.id;
        existingManifest = m;
        break;
      }
    }

    // Merge by URL so re-deploys don't duplicate files.
    const existingEls: WrapboxElement[] = Array.isArray(existingManifest?.elements) ? existingManifest.elements : [];
    const seenEls = new Set(existingEls.map((e) => e.url));
    const mergedEls = [...existingEls, ...elements.filter((e) => !seenEls.has(e.url))];
    // The production pack rides in the manifest (NOT as an element, so the
    // browser-side "Download All" zip never tries to re-zip the big ZIP) and
    // as the row's pack_url — the WrapBox card's download button.
    const productionPack = packZip
      ? {
          zip_url: packZip.url,
          zip_path: packZip.path ?? null,
          zip_size: packZip.size ?? null,
          file_count: packZip.file_count ?? null,
          files: Array.isArray(packZip.files) ? packZip.files : null,
          built_at: packZip.built_at ?? null,
          panels: printWorker.panels || null,
        }
      : existingManifest?.production_pack || null;
    // CANONICAL DESIGN ID — resolve the DesignIQ generation id (admin_notes
    // back-link, same resolution the vault/board/worker use) and stamp it +
    // the DID into the manifest, so WrapBox/DesignVault pack cards show the
    // SAME DID as the QC certificate, RevisionStudio, and DesignPro.
    let canonicalGid: string | null = job.generation_id ? String(job.generation_id) : null;
    if (canonicalGid) {
      try {
        const { data: viz } = await sb.from("color_visualizations")
          .select("admin_notes").eq("id", canonicalGid).maybeSingle();
        const raw = (viz as any)?.admin_notes;
        const n = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
        if (n?.designiq_generation_id) canonicalGid = String(n.designiq_generation_id);
      } catch { /* keep generation_id */ }
    }
    const didHex = String(canonicalGid || "").replace(/-/g, "");
    const did = didHex.length >= 8 ? `DID-${didHex.slice(0, 8).toUpperCase()}` : null;

    const manifest = {
      wrapbox_kind: "qc_elements",
      job_id,
      order_number: orderNumber,
      ...(canonicalGid ? { designiq_generation_id: canonicalGid } : {}),
      ...(did ? { did } : {}),
      approval_ref: approvalRef,
      workflow_run_id: workflowRun.id,
      source_hash: printWorker.source_hash,
      pack_version: printWorker.pack_version,
      run_key: printWorker.run_key,
      elements: mergedEls,
      ...(productionPack ? { production_pack: productionPack } : {}),
    };

    if (packId) {
      const update: Record<string, any> = {
        panels_selected: manifest,
        file_count: mergedEls.length,
        upscale_status: "ready",
      };
      if (productionPack?.zip_url) update.pack_url = productionPack.zip_url;
      if (thumbnailUrl) update.thumbnail_url = thumbnailUrl;
      const { error } = await sb.from("production_packs").update(update).eq("id", packId);
      if (error) return json({ error: `Pack update failed: ${error.message}` }, 500);
    } else {
      const { data, error } = await sb
        .from("production_packs")
        .insert({
          user_id: job.user_id,
          shop_id: shopId,
          design_name: designName,
          panels_selected: manifest,
          thumbnail_url: thumbnailUrl ?? mergedEls[0]?.url ?? null,
          pack_url: productionPack?.zip_url ?? mergedEls[0]?.url ?? null,
          file_count: mergedEls.length,
          upscale_status: "ready",
          finish_type: concept.finish ?? null,
          vehicle_info: vehicleInfo,
        })
        .select("id")
        .single();
      if (error || !data) return json({ error: `Pack insert failed: ${error?.message || "unknown"}` }, 500);
      packId = data.id;
    }

    // ── Mark the job delivered ──
    const updatedConcept = {
      ...concept,
      qc_data: {
        ...(concept.qc_data || {}),
        state: "deployed_wrapbox",
        deployed_at: nowIso,
        approval_ref: approvalRef,
        workflow_run_id: workflowRun.id,
      },
    };
    // NOTE: the panelizer_jobs status CHECK constraint has no 'delivered' —
    // the original update failed SILENTLY on every deploy, leaving jobs stuck
    // at pending_qc after the designer pressed Approve. 'ready' is the
    // sanctioned terminal state (designer-qc ships with it; the GENIE card and
    // QC card treat ready as delivered).
    const { data: persistedJob, error: jobUpErr } = await sb
      .from("panelizer_jobs")
      .update({ status: "ready", delivered_at: new Date().toISOString(), concept_json: updatedConcept })
      .eq("id", job_id)
      .eq("status", job.status)
      .select("id")
      .maybeSingle();
    if (jobUpErr) return json({ error: `WrapBox status persistence failed: ${jobUpErr.message}` }, 500);
    if (!persistedJob?.id) return json({ error: "WrapBox status persistence lost a concurrent update" }, 409);

    // ── POST-QC GIGAPIXEL ENHANCE (owner 2026-08-11) — fire-and-forget ──
    // Topaz is non-deterministic, so it NEVER runs inside the fenced pack
    // (the worker forbids it after Call 7 and that fence stays). The owner's
    // call: enhance AFTER human QC approval. Delivery IS that approval, so
    // kick the worker's post-QC /enhance-pack here; the endpoint refuses jobs
    // without a QC stamp, needs TOPAZ_API_KEY on the droplet, and stamps
    // concept_json.print_worker.enhanced as evidence. Non-fatal: delivery
    // never waits on Topaz.
    try {
      const workerUrl = (Deno.env.get("WORKER_URL") || "").replace(/\/+$/, "");
      const workerSecret = (Deno.env.get("WORKER_SECRET") || "").trim();
      if (workerUrl && workerSecret) {
        await sb.rpc("kick_print_worker", {
          p_url: `${workerUrl}/enhance-pack`,
          p_secret: workerSecret,
          p_body: { jobId: job_id, userId: job.user_id, orderNumber: orderNumber },
        });
      }
    } catch (e) {
      console.warn("[deploy-to-wrapbox] enhance kick failed (non-fatal):", (e as Error)?.message);
    }

    // ── Notify the customer (non-fatal) ──
    let notified = false;
    try {
      const { data: customer } = await sb.auth.admin.getUserById(job.user_id);
      const customerEmail = customer?.user?.email;
      if (customerEmail) {
        const resp = await fetch(`${supabaseUrl}/functions/v1/send-design-pack-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
          },
          body: JSON.stringify({
            email: customerEmail,
            designName,
            downloadUrl: "https://restyleproai.com/wrapbox",
            // WrapBox files don't expire, but the template renders {{expiry_date}} —
            // without a value it printed "Invalid Date". 30 days keeps urgency honest.
            expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
          }),
        });
        notified = resp.ok;
        if (!resp.ok) {
          console.warn(`[deploy-to-wrapbox] email send ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
        }
      } else {
        console.warn("[deploy-to-wrapbox] no customer email found — skipping notification");
      }
    } catch (e) {
      console.warn("[deploy-to-wrapbox] notification error (non-fatal):", (e as Error)?.message);
    }

    return json({
      success: true, packId, fileCount: mergedEls.length, notified,
      productionPackZip: productionPack?.zip_url ?? null,
      productionPackFiles: productionPack?.file_count ?? 0,
    });
  } catch (err) {
    console.error("[deploy-to-wrapbox] error:", err);
    return json({ error: (err as Error)?.message || "Unexpected failure" }, 500);
  }
});
