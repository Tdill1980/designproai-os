/**
 * export-to-gcs — Upload production files to Google Cloud Storage
 *
 * Called after "Approve & Upscale" on QC Artboard.
 * Uploads the upscaled artboard + individual panel crops to the
 * restylepro-production-files GCS bucket, organized by order number.
 *
 * Lance and the production team access files directly from GCS.
 * No Photoshop recreation needed — files are print-ready.
 *
 * Requires secrets:
 *   GCS_SERVICE_ACCOUNT_JSON — full service account key JSON
 *   GCS_BUCKET — bucket name (restylepro-production-files)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Sign a JWT for Google Cloud using the service account key */
async function getGcsAccessToken(): Promise<string> {
  const raw = Deno.env.get("GCS_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new Error("GCS_SERVICE_ACCOUNT_JSON not set");

  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);

  // Build JWT header + claim
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/devstorage.read_write",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const enc = (obj: unknown) => btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsignedToken = `${enc(header)}.${enc(claim)}`;

  // Import RSA private key
  const pemBody = sa.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\n/g, "");
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const jwt = `${unsignedToken}.${sigB64}`;

  // Exchange JWT for access token
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`GCS auth failed: ${resp.status} ${err}`);
  }

  const { access_token } = await resp.json();
  return access_token;
}

/** Upload a file to GCS */
async function uploadToGcs(
  bucket: string,
  path: string,
  data: Uint8Array,
  contentType: string,
  accessToken: string
): Promise<string> {
  const encodedPath = encodeURIComponent(path);
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodedPath}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": contentType,
    },
    body: data,
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`GCS upload failed: ${resp.status} ${err}`);
  }

  const result = await resp.json();
  return `https://storage.googleapis.com/${bucket}/${path}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { job_id, order_number } = await req.json();
    if (!job_id) {
      return new Response(
        JSON.stringify({ error: "job_id required" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const bucket = Deno.env.get("GCS_BUCKET") || "restylepro-production-files";
    const accessToken = await getGcsAccessToken();

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get job data
    const { data: job, error: jobErr } = await sb
      .from("panelizer_jobs")
      .select("*, concept_json")
      .eq("id", job_id)
      .single();

    if (jobErr || !job) {
      return new Response(
        JSON.stringify({ error: "Job not found" }),
        { status: 404, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const orderNum = order_number || job.order_number || `JOB-${job_id.slice(0, 8)}`;
    const vehicleName = `${job.vehicle_year || ""} ${job.vehicle_make || ""} ${job.vehicle_model || ""}`.trim();
    const gcsFolder = `orders/${orderNum}`;
    const uploadedFiles: string[] = [];

    console.log(`[GCS] Exporting ${orderNum} — ${vehicleName}`);

    // Upload the artboard
    const cj = job.concept_json || {};
    const artboardPath = cj.artboard_storage_path || `artboards/${job_id}/artboard.png`;

    // Try upscaled version first, then original
    const upscaledPath = cj.qc_data?.upscaled_storage_path || artboardPath.replace("artboard.png", "artboard-upscaled.png");

    for (const path of [upscaledPath, artboardPath]) {
      try {
        const { data: fileData } = await sb.storage.from("wrap-files").download(path);
        if (fileData) {
          const bytes = new Uint8Array(await fileData.arrayBuffer());
          const gcsPath = `${gcsFolder}/${orderNum}_artboard.png`;
          const url = await uploadToGcs(bucket, gcsPath, bytes, "image/png", accessToken);
          uploadedFiles.push(url);
          console.log(`[GCS] Uploaded artboard: ${gcsPath} (${(bytes.length / 1024 / 1024).toFixed(1)}MB)`);
          break;
        }
      } catch { /* try next */ }
    }

    // Upload individual render views
    const viewUrls = job.all_view_urls || cj.all_view_urls || cj.render_urls || {};
    for (const [viewType, viewUrl] of Object.entries(viewUrls)) {
      if (!viewUrl || typeof viewUrl !== "string") continue;
      try {
        const resp = await fetch(viewUrl as string, { signal: AbortSignal.timeout(15000) });
        if (!resp.ok) continue;
        const bytes = new Uint8Array(await resp.arrayBuffer());
        const ext = (resp.headers.get("content-type") || "").includes("jpeg") ? "jpg" : "png";
        const gcsPath = `${gcsFolder}/${orderNum}_${viewType}.${ext}`;
        const url = await uploadToGcs(bucket, gcsPath, bytes, `image/${ext === "jpg" ? "jpeg" : "png"}`, accessToken);
        uploadedFiles.push(url);
        console.log(`[GCS] Uploaded view: ${viewType} (${(bytes.length / 1024).toFixed(0)}KB)`);
      } catch (e) {
        console.warn(`[GCS] View ${viewType} upload failed:`, e);
      }
    }

    // Upload 2D proof if available
    const flatProofUrl = cj.flat_proof_url;
    if (flatProofUrl) {
      try {
        const resp = await fetch(flatProofUrl, { signal: AbortSignal.timeout(15000) });
        if (resp.ok) {
          const bytes = new Uint8Array(await resp.arrayBuffer());
          const gcsPath = `${gcsFolder}/${orderNum}_2d-proof.png`;
          await uploadToGcs(bucket, gcsPath, bytes, "image/png", accessToken);
          uploadedFiles.push(`https://storage.googleapis.com/${bucket}/${gcsPath}`);
          console.log(`[GCS] Uploaded 2D proof`);
        }
      } catch { /* non-fatal */ }
    }

    // Update job with GCS export info
    await sb.from("panelizer_jobs").update({
      concept_json: {
        ...cj,
        gcs_export: {
          bucket,
          folder: gcsFolder,
          files: uploadedFiles,
          exported_at: new Date().toISOString(),
        },
      },
    }).eq("id", job_id);

    console.log(`[GCS] Export complete: ${uploadedFiles.length} files → gs://${bucket}/${gcsFolder}`);

    return new Response(
      JSON.stringify({
        success: true,
        bucket,
        folder: gcsFolder,
        files: uploadedFiles,
        consoleUrl: `https://console.cloud.google.com/storage/browser/${bucket}/${gcsFolder}`,
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[GCS] Export error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Export failed" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
