// ──────────────────────────────────────────────────────────────────────
// proof-attach-to-wrapbox
//
// Fires after a customer signs/approves a proof. Resolves the proof's
// order_number against panelizer_jobs / design_pack_purchases / wpw_orders
// (same 3-table fallback the Single Upscaler uses), copies the approved
// render into wrap-files/wrapbox/{order_number}/proof/, and appends an
// element with kind="design_panel" to that pack's panels_selected manifest.
//
// Idempotent — if an element with the same source render_url is already
// in the manifest we skip. proof-sign calls this fire-and-forget so a
// failure here NEVER blocks customer approval.
//
// Body: { proof_id: string }
// ──────────────────────────────────────────────────────────────────────

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface JobMatch {
  jobId: string;
  orderNumber: string;
  source: "panelizer_jobs" | "design_pack_purchases" | "wpw_orders";
  vehicleInfo?: { year?: string | number | null; make?: string | null; model?: string | null } | null;
  finishType?: string | null;
}

interface WrapboxElement {
  id: string;
  kind: "design_panel" | "element" | "background" | "vector";
  label: string;
  url: string;
  source_url?: string;
  scale?: number;
  added_at: string;
  added_by?: string | null;
}

interface WrapboxManifest {
  wrapbox_kind: "qc_elements";
  job_id: string;
  order_number: string;
  elements: WrapboxElement[];
}

const BUCKET = "wrap-files";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cryptoId(): string {
  return crypto.randomUUID();
}

async function findJobByOrderNumber(
  db: SupabaseClient,
  q: string,
): Promise<JobMatch | null> {
  const trimmed = q.trim();
  if (!trimmed) return null;

  // 1. panelizer_jobs.order_number
  const { data: pj } = await db
    .from("panelizer_jobs")
    .select("id, order_number, vehicle_year, vehicle_make, vehicle_model, finish_type")
    .eq("order_number", trimmed)
    .maybeSingle();
  if (pj) {
    const r = pj as Record<string, unknown>;
    return {
      jobId: r.id as string,
      orderNumber: r.order_number as string,
      source: "panelizer_jobs",
      vehicleInfo: {
        year: (r.vehicle_year as string | number | null) ?? null,
        make: (r.vehicle_make as string | null) ?? null,
        model: (r.vehicle_model as string | null) ?? null,
      },
      finishType: (r.finish_type as string | null) ?? null,
    };
  }

  // 2. design_pack_purchases (Stripe)
  const { data: dpp } = await db
    .from("design_pack_purchases")
    .select("id, order_number, customer_order_number, vehicle_year, vehicle_make, vehicle_model")
    .or(`order_number.eq.${trimmed},customer_order_number.eq.${trimmed}`)
    .maybeSingle();
  if (dpp) {
    const r = dpp as Record<string, unknown>;
    return {
      jobId: r.id as string,
      orderNumber:
        (r.order_number as string | null) ||
        (r.customer_order_number as string | null) ||
        trimmed,
      source: "design_pack_purchases",
      vehicleInfo: {
        year: (r.vehicle_year as string | number | null) ?? null,
        make: (r.vehicle_make as string | null) ?? null,
        model: (r.vehicle_model as string | null) ?? null,
      },
      finishType: null,
    };
  }

  // 3. wpw_orders (WePrintWraps Woo)
  const { data: wpw } = await db
    .from("wpw_orders")
    .select("id, order_number")
    .eq("order_number", trimmed)
    .maybeSingle();
  if (wpw) {
    const r = wpw as Record<string, unknown>;
    return {
      jobId: String(r.id),
      orderNumber: (r.order_number as string) || trimmed,
      source: "wpw_orders",
      vehicleInfo: null,
      finishType: null,
    };
  }

  return null;
}

async function fetchAsBlob(
  db: SupabaseClient,
  url: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  // If the URL is a Supabase storage public/signed URL, fetch it directly;
  // browser-style fetch works server-side too because URLs are addressable.
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Source fetch failed: ${res.status}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  return { bytes: buf, contentType: res.headers.get("content-type") || "image/png" };
}

function pickActiveRenderUrl(version: Record<string, unknown> | null): string | null {
  if (!version) return null;
  const renders = version.render_urls;
  if (Array.isArray(renders) && renders.length > 0) {
    // Last entry = the most recent render the customer signed off on
    const last = renders[renders.length - 1];
    if (typeof last === "string" && last) return last;
    if (last && typeof last === "object" && typeof (last as any).url === "string") {
      return (last as any).url;
    }
  }
  return null;
}

function resolveOrderNumber(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  const candidates = [
    metadata.wpw_order_number,
    metadata.woo_order_number,
    metadata.order_number,
  ];
  for (const v of candidates) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

Deno.serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let proofId: string | null = null;
  try {
    const body = (await req.json()) as { proof_id?: string };
    proofId = (body?.proof_id || "").trim() || null;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!proofId) return json({ error: "proof_id is required" }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── Load proof_approvals + the active proof_versions render ──
  const { data: proof, error: proofErr } = await db
    .from("proof_approvals")
    .select(
      "id, shop_id, status, design_name, finish_type, vehicle_year, vehicle_make, vehicle_model, customer_email, signer_typed_name, metadata",
    )
    .eq("id", proofId)
    .maybeSingle();
  if (proofErr || !proof) {
    return json({ error: "Proof not found", detail: proofErr?.message }, 404);
  }
  if (proof.status !== "approved") {
    return json({ skipped: true, reason: `proof status is ${proof.status}` });
  }

  const orderNumber = resolveOrderNumber(proof.metadata as Record<string, unknown> | null);
  if (!orderNumber) {
    console.warn(`[proof-attach-to-wrapbox] proof ${proof.id} has no order number in metadata; skipping`);
    return json({ skipped: true, reason: "no order_number in proof metadata" });
  }

  const job = await findJobByOrderNumber(db, orderNumber);
  if (!job) {
    console.warn(
      `[proof-attach-to-wrapbox] proof ${proof.id}: order ${orderNumber} not found in any job table`,
    );
    return json({ skipped: true, reason: `order ${orderNumber} not found in any job table` });
  }

  // Active version's render URL (the customer signed off on this image)
  const { data: version } = await db
    .from("proof_versions")
    .select("id, version_number, render_urls, is_active")
    .eq("proof_id", proof.id)
    .eq("is_active", true)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const renderUrl = pickActiveRenderUrl(version as Record<string, unknown> | null);
  if (!renderUrl) {
    return json({ skipped: true, reason: "no active render_url on proof" });
  }

  // ── Idempotency: skip if a manifest element already references this URL ──
  const { data: existingPack } = await db
    .from("production_packs")
    .select("id, panels_selected")
    .eq("shop_id", proof.shop_id)
    .order("created_at", { ascending: false });

  let foundPack: { id: string; manifest: WrapboxManifest } | null = null;
  for (const row of (existingPack || []) as { id: string; panels_selected: any }[]) {
    const m = row.panels_selected;
    if (m && m.wrapbox_kind === "qc_elements" && m.job_id === job.jobId) {
      foundPack = { id: row.id, manifest: m as WrapboxManifest };
      break;
    }
  }

  if (foundPack) {
    const dup = foundPack.manifest.elements.find(
      (e) => e.url === renderUrl || e.source_url === renderUrl,
    );
    if (dup) {
      return json({ skipped: true, reason: "render already attached to pack", pack_id: foundPack.id });
    }
  }

  // ── Copy the render bytes into wrap-files/wrapbox/{order}/proof/ ──
  const { bytes, contentType } = await fetchAsBlob(db, renderUrl);
  const ext = (contentType.split("/")[1] || "png").split(";")[0];
  const fileName = `proof/approved-${Date.now()}.${ext}`;
  const path = `wrapbox/${job.orderNumber}/${fileName}`;
  const { error: upErr } = await db.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (upErr) {
    return json({ error: "Storage upload failed", detail: upErr.message }, 500);
  }
  const { data: urlData } = db.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = urlData.publicUrl;

  const stamped: WrapboxElement = {
    id: cryptoId(),
    kind: "design_panel",
    label: "Approved Proof",
    url: publicUrl,
    source_url: renderUrl,
    added_at: new Date().toISOString(),
    added_by: proof.customer_email || proof.signer_typed_name || "ApprovePro",
  };

  if (foundPack) {
    const elements = [...foundPack.manifest.elements, stamped];
    const manifest: WrapboxManifest = { ...foundPack.manifest, elements };
    const { error: updErr } = await db
      .from("production_packs")
      .update({
        panels_selected: manifest,
        file_count: elements.length,
        thumbnail_url: stamped.url, // approved proof becomes the new card thumb
      })
      .eq("id", foundPack.id);
    if (updErr) return json({ error: "Pack update failed", detail: updErr.message }, 500);
    return json({
      ok: true,
      action: "appended",
      pack_id: foundPack.id,
      element_id: stamped.id,
      order_number: job.orderNumber,
    });
  }

  // No pack yet for this job — create one
  const designName = (proof.design_name as string | null) || `Approved Proof — ${job.orderNumber}`;
  const vehicleInfo = job.vehicleInfo || {
    year: (proof.vehicle_year as string | null) ?? undefined,
    make: (proof.vehicle_make as string | null) ?? undefined,
    model: (proof.vehicle_model as string | null) ?? undefined,
  };
  const manifest: WrapboxManifest = {
    wrapbox_kind: "qc_elements",
    job_id: job.jobId,
    order_number: job.orderNumber,
    elements: [stamped],
  };

  // We need a user_id to satisfy the production_packs not-null constraint.
  // proof_approvals doesn't store one, so look up the shop owner.
  const { data: shop } = await db
    .from("shops")
    .select("owner_user_id")
    .eq("id", proof.shop_id)
    .maybeSingle();
  const ownerUserId = (shop as { owner_user_id?: string } | null)?.owner_user_id;
  if (!ownerUserId) {
    return json(
      { error: "Cannot create pack: shop has no owner_user_id", shop_id: proof.shop_id },
      500,
    );
  }

  const { data: inserted, error: insErr } = await db
    .from("production_packs")
    .insert({
      user_id: ownerUserId,
      shop_id: proof.shop_id,
      design_name: designName,
      panels_selected: manifest,
      thumbnail_url: stamped.url,
      pack_url: stamped.url,
      file_count: 1,
      upscale_status: "ready",
      finish_type: (proof.finish_type as string | null) ?? job.finishType ?? null,
      vehicle_info: vehicleInfo,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    return json({ error: "Pack insert failed", detail: insErr?.message }, 500);
  }
  return json({
    ok: true,
    action: "created",
    pack_id: (inserted as { id: string }).id,
    element_id: stamped.id,
    order_number: job.orderNumber,
  });
});
