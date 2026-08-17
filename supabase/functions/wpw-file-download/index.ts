/**
 * wpw-file-download — server-side download proxy for customer-uploaded
 * artwork on WPW orders.
 *
 * Why this exists: customer files on weprintwraps.com are cross-origin
 * to restyleproai.com, so the browser silently ignores `<a download>`
 * and opens PDFs / images inline in a new tab instead of saving them.
 * This proxy fetches the file server-side and returns it with
 * `Content-Disposition: attachment` so the browser ALWAYS saves it.
 *
 * Per CLAUDE.md hard rule: this function MUST be listed in
 * supabase/config.toml with `verify_jwt = false`.
 *
 * Security: strict host allowlist (the only places customer artwork
 * actually lives, per a sweep of `wpw_order_items.meta`). Cannot be
 * used as a generic open proxy. 200 MB hard cap on response size.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_HOSTS = new Set([
  "weprintwraps.com",
  "www.weprintwraps.com",
  "dropbox.com",
  "www.dropbox.com",
  "dl.dropboxusercontent.com",
]);

const MAX_BYTES = 200 * 1024 * 1024; // 200 MB

function plainResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/plain" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return plainResponse("Method not allowed", 405);
  }

  const reqUrl = new URL(req.url);
  const target = reqUrl.searchParams.get("u");
  if (!target) return plainResponse("Missing 'u' parameter", 400);

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return plainResponse("Invalid URL", 400);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return plainResponse("Only http(s) URLs are supported", 400);
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
    return plainResponse("Host not allowed", 403);
  }

  // Dropbox preview pages return HTML; appending dl=1 forces the
  // direct file download.
  if (parsed.hostname.toLowerCase().endsWith("dropbox.com")) {
    parsed.searchParams.set("dl", "1");
  }

  let upstream: Response;
  try {
    upstream = await fetch(parsed.toString(), { redirect: "follow" });
  } catch (e) {
    return plainResponse(
      `Upstream fetch error: ${(e as Error).message}`,
      502,
    );
  }

  if (!upstream.ok) {
    return plainResponse(`Upstream returned ${upstream.status}`, upstream.status);
  }

  const lenHeader = upstream.headers.get("content-length");
  if (lenHeader) {
    const n = parseInt(lenHeader, 10);
    if (Number.isFinite(n) && n > MAX_BYTES) {
      return plainResponse("File too large", 413);
    }
  }

  // Filename derived from URL path; sanitised so quotes / control chars
  // can't escape the Content-Disposition header.
  const lastSeg =
    decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "") ||
    "download";
  const safeName = lastSeg.replace(/[^A-Za-z0-9._\- ]/g, "_").slice(0, 200) ||
    "download";

  const headers = new Headers(corsHeaders);
  headers.set(
    "Content-Type",
    upstream.headers.get("content-type") || "application/octet-stream",
  );
  headers.set("Content-Disposition", `attachment; filename="${safeName}"`);
  if (lenHeader) headers.set("Content-Length", lenHeader);

  return new Response(upstream.body, { headers });
});
