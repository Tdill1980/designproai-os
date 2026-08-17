/**
 * approvepro-versions — service-role version history + full job context for the
 * ApprovePro admin workbench AND the RevisionStudioIQ editor.
 *
 * The browser reads `proof_versions` directly, which is gated by the
 * `shop_owner_versions` RLS policy (team must share the order's shop). WPW
 * auto-ingested orders carry a shop the admin may not be team-linked to, so the
 * direct read can come back EMPTY even though versions exist. The admin
 * workbench must always see every version, so this endpoint reads with the
 * service role (RLS-bypassing) and returns the full history for one proof.
 *
 * It ALSO returns the customer's uploaded reference photos (private
 * `proof-uploads` bucket, signed) and the public intake/context assets, so the
 * shop can refine in RevisionStudio with every upload + prompt + version in
 * front of them instead of regenerating blind.
 *
 * Input:  { proof_id: string }
 * Output: {
 *   versions: [{ id, version_number, created_by_role, is_active, created_at,
 *                render_urls, uploaded_file_paths, reference_image_paths, prompt_text }],
 *   customer_uploads: [{ path, name, url, created_at }],   // signed, 6h
 *   context_assets:   [{ path, name, url, created_at }],   // public
 * }
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface Asset {
  path: string;
  name: string;
  url: string;
  created_at: string | null;
}

const SIGNED_TTL = 60 * 60 * 6; // 6h — long enough for a refine session

/**
 * Recursively collect every customer-uploaded file under
 * `proof-uploads/{proofId}/customer-refs/**` and sign each one. Uploads are
 * foldered per revision turn (customer-refs/1/, /2/, …) so we descend one level.
 */
async function listCustomerUploads(db: any, proofId: string): Promise<Asset[]> {
  const base = `${proofId}/customer-refs`;
  const out: Asset[] = [];
  const { data: entries } = await db.storage
    .from("proof-uploads")
    .list(base, { limit: 1000, sortBy: { column: "name", order: "asc" } });

  for (const entry of entries || []) {
    // Folder placeholders come back with a null id.
    if (entry.id === null || entry.id === undefined) {
      const sub = `${base}/${entry.name}`;
      const { data: files } = await db.storage
        .from("proof-uploads")
        .list(sub, { limit: 1000 });
      for (const f of files || []) {
        if (f.id === null || f.id === undefined) continue;
        const path = `${sub}/${f.name}`;
        const { data: signed } = await db.storage
          .from("proof-uploads")
          .createSignedUrl(path, SIGNED_TTL);
        if (signed?.signedUrl) {
          out.push({ path, name: f.name, url: signed.signedUrl, created_at: f.created_at ?? null });
        }
      }
    } else {
      const path = `${base}/${entry.name}`;
      const { data: signed } = await db.storage
        .from("proof-uploads")
        .createSignedUrl(path, SIGNED_TTL);
      if (signed?.signedUrl) {
        out.push({ path, name: entry.name, url: signed.signedUrl, created_at: entry.created_at ?? null });
      }
    }
  }
  out.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  return out;
}

/** Public intake/context assets that live in the public wrap-files bucket. */
async function listContextAssets(db: any, proofId: string): Promise<Asset[]> {
  const base = `approvepro-context/${proofId}`;
  const out: Asset[] = [];
  const { data: files } = await db.storage
    .from("wrap-files")
    .list(base, { limit: 1000 });
  for (const f of files || []) {
    if (f.id === null || f.id === undefined) continue;
    const path = `${base}/${f.name}`;
    const { data: pub } = db.storage.from("wrap-files").getPublicUrl(path);
    if (pub?.publicUrl) {
      out.push({ path, name: f.name, url: pub.publicUrl, created_at: f.created_at ?? null });
    }
  }
  out.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  return out;
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let proofId: string | null = null;
  try {
    const body = await req.json();
    proofId = body?.proof_id || null;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!proofId) return json({ error: "proof_id required" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await db
    .from("proof_versions")
    .select("id, version_number, created_by_role, is_active, created_at, render_urls, uploaded_file_paths, reference_image_paths, prompt_text")
    .eq("proof_id", proofId)
    .order("version_number", { ascending: false });

  if (error) {
    console.error("approvepro-versions:", error.message);
    return json({ error: error.message }, 500);
  }

  // Asset collection is best-effort — never fail the version history because a
  // storage listing hiccuped.
  let customerUploads: Asset[] = [];
  let contextAssets: Asset[] = [];
  try {
    customerUploads = await listCustomerUploads(db, proofId);
  } catch (e) {
    console.warn("approvepro-versions: customer uploads listing failed:", (e as Error)?.message);
  }
  try {
    contextAssets = await listContextAssets(db, proofId);
  } catch (e) {
    console.warn("approvepro-versions: context assets listing failed:", (e as Error)?.message);
  }

  return json({
    versions: data || [],
    customer_uploads: customerUploads,
    context_assets: contextAssets,
  });
});
