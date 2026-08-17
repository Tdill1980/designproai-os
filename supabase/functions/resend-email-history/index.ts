/**
 * resend-email-history — read the real "Sent" history from Resend for the
 * ApprovePro design email (Design@weprintwraps.com).
 *
 * Why: ApprovePro's proof-send path does not reliably mirror sends into
 * email_log, and much design correspondence was sent manually — so the only
 * authoritative record of what actually went out to a customer lives in
 * Resend. This function pages Resend's GET /emails (sent) list, filters to the
 * design sender (and optionally one customer), and returns a normalized,
 * newest-first history so the workbench can show "what we've emailed this
 * customer, when, and whether they opened it."
 *
 * POST body:
 *   recipient?   — only emails sent TO this address (case-insensitive contains)
 *   from_filter? — sender needle (defaults to design@weprintwraps.com; pass ""
 *                  to include every sender)
 *   max_pages?   — Resend pages of 100 to scan (default 5, max 15)
 *
 * Auth required (mirrors proof-revoke). Per JWT.md §1: verify_jwt = false.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_FROM_NEEDLE = "design@weprintwraps.com";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("authorization");
    if (!authHeader) return jsonResponse({ error: "Authentication required" }, 401);
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Invalid auth token" }, 401);

    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) return jsonResponse({ error: "RESEND_API_KEY not configured" }, 500);

    let body: { recipient?: string; from_filter?: string; max_pages?: number } = {};
    try {
      body = await req.json();
    } catch {
      // empty body is fine — returns the design email's whole recent history
    }

    const recipient = String(body.recipient || "").trim().toLowerCase();
    const fromNeedle = (body.from_filter === undefined
      ? DEFAULT_FROM_NEEDLE
      : String(body.from_filter)).toLowerCase();
    const maxPages = Math.min(Math.max(Number(body.max_pages) || 5, 1), 15);

    const out: any[] = [];
    let after: string | undefined;
    let scanned = 0;

    for (let p = 0; p < maxPages; p++) {
      const url = new URL("https://api.resend.com/emails");
      url.searchParams.set("limit", "100");
      if (after) url.searchParams.set("after", after);

      const r = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!r.ok) {
        const detail = await r.text().catch(() => "");
        return jsonResponse(
          { error: "Resend list request failed", status: r.status, detail: detail.slice(0, 500) },
          502,
        );
      }
      const j = await r.json();
      const data: any[] = Array.isArray(j?.data) ? j.data : (Array.isArray(j?.emails) ? j.emails : []);
      if (data.length === 0) break;

      for (const e of data) {
        scanned++;
        const from = String(e?.from || "").toLowerCase();
        const toArr = (Array.isArray(e?.to) ? e.to : [e?.to])
          .filter(Boolean)
          .map((x: any) => String(x).toLowerCase());
        if (fromNeedle && !from.includes(fromNeedle)) continue;
        if (recipient && !toArr.some((t) => t.includes(recipient))) continue;
        out.push({
          id: e?.id,
          from: e?.from,
          to: e?.to,
          subject: e?.subject || "",
          created_at: e?.created_at,
          last_event: e?.last_event || null,
        });
      }

      after = data[data.length - 1]?.id;
      if (!j?.has_more || !after) break;
    }

    out.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

    return jsonResponse({
      success: true,
      sender: fromNeedle || "(any)",
      recipient: recipient || null,
      scanned,
      count: out.length,
      emails: out,
    });
  } catch (err: any) {
    console.error("resend-email-history: unexpected error:", err);
    return jsonResponse({ error: "Unexpected server error", detail: String(err?.message || err) }, 500);
  }
});
