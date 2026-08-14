/**
 * sidecar-url.ts — resolve the Vercel serverless ("sidecar") base for browser calls.
 *
 * The `/api/*` serverless functions (e.g. the deterministic production-pack
 * slicer) are only served on the **www** host in production. The apex domain
 * `restyleproai.com` returns Vercel `404 DEPLOYMENT_NOT_FOUND` for `/api/*`,
 * which made "Build Panel Files" silently 404 when the app was loaded on the
 * apex. The server-to-server caller already hardcodes the www host
 * (`designpro-ensure-qc-job` → `https://designproai.com/api/...`); this
 * mirrors that decision for browser callers.
 *
 * On the apex we return an absolute www URL (cross-origin — the sidecar sends
 * `Access-Control-Allow-Origin: *`). On www, preview deployments, and
 * localhost the `/api/*` route resolves normally, so we keep it relative.
 */
import { supabase } from "@/integrations/supabase/client";

export function sidecarUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (typeof window !== "undefined" && window.location.hostname === "restyleproai.com") {
    return `https://designproai.com${p}`;
  }
  return p;
}

/**
 * Run the deterministic production-pack slicer (api/process-production-pack).
 *
 * ROOT CAUSE of "nothing ever produced a file": the Supabase BACKEND cannot
 * reach the Vercel slicer — pg_net kicks return 404 DEPLOYMENT_NOT_FOUND and the
 * production-slice-proxy edge fetch hangs, so jobs sat in "queued" forever. The
 * BROWSER, however, reaches the www host fine, and the slicer accepts a
 * logged-in user's Supabase JWT (handler auth path #3, "browser admin button").
 *
 * So we call the slicer DIRECTLY from the browser with the user's access token.
 * Proven: a direct client call to the slicer produces the real ZIP
 * (true-size CMYK TIFF + 2" bleed + QC cert) synchronously and returns
 * { success, zip_url }.
 *
 * Returns the slicer's Response (status + JSON passed straight through), so
 * callers keep their existing res.ok / res.status / res.json() handling.
 */
export async function postProductionSlice(body: Record<string, unknown>): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || "";
  const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  return fetch(sidecarUrl("/api/process-production-pack"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // The slicer authenticates the logged-in user's JWT (auth path #3) and runs
      // its DB ops under that token (RLS-scoped to the user's own job).
      Authorization: `Bearer ${token || anon}`,
    },
    body: JSON.stringify(body),
  });
}
