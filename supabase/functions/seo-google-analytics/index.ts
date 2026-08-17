/**
 * seo-google-analytics — GA4 Data API queries.
 *
 * Actions:
 *   list_properties      → list GA4 properties for the connected account
 *   set_property         → save the chosen propertyId in metadata
 *   summary              → 28d sessions, users, conversions, revenue
 *   top_pages            → top landing pages by sessions
 *   channels             → traffic by default channel grouping
 *   post_attribution     → traffic + conversions for a specific page url
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { authenticate, assertShopMember, assertShopAdmin } from "../_shared/seo/auth.ts";
import { getValidGoogleAccessToken } from "../_shared/seo/google-oauth.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function gaFetch(token: string, url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(url, { ...init, headers });
}

interface GAReportResp {
  rows?: Array<{ dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> }>;
  rowCount?: number;
  totals?: Array<{ metricValues: Array<{ value: string }> }>;
}

function dateRange(days: number) {
  const end = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  const start = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  return { startDate: start, endDate: end };
}

async function runReport(
  token: string,
  propertyId: string,
  payload: Record<string, unknown>,
): Promise<GAReportResp> {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
  const res = await gaFetch(token, url, { method: "POST", body: JSON.stringify(payload) });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GA4 ${res.status}: ${txt.slice(0, 400)}`);
  }
  return res.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const ctx = await authenticate(req);
    const body = await req.json();
    const shop_id = body?.shop_id as string;
    const action = body?.action as string;
    if (!shop_id || !action) return json({ error: "shop_id + action required" }, 400);
    await assertShopMember(ctx, shop_id);

    const { access_token, metadata } = await getValidGoogleAccessToken(
      ctx.service,
      shop_id,
      "google_analytics",
    );

    if (action === "list_properties") {
      // Use the Admin API to enumerate accounts + properties
      const acctRes = await gaFetch(
        access_token,
        "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=100",
      );
      if (!acctRes.ok) {
        const txt = await acctRes.text();
        return json({ error: `GA4 ${acctRes.status}: ${txt.slice(0, 400)}` }, 502);
      }
      const data = await acctRes.json();
      const accounts: Array<{
        account: string;
        displayName: string;
        propertySummaries?: Array<{ property: string; displayName: string }>;
      }> = data.accountSummaries ?? [];
      const properties = accounts.flatMap((a) =>
        (a.propertySummaries ?? []).map((p) => ({
          property_id: p.property.replace("properties/", ""),
          property_name: p.displayName,
          account_name: a.displayName,
        })),
      );
      return json({ ok: true, properties });
    }

    if (action === "set_property") {
      await assertShopAdmin(ctx, shop_id);
      const propertyId = body?.property_id as string;
      if (!propertyId) return json({ error: "property_id required" }, 400);
      const newMeta = { ...metadata, ga4_property_id: propertyId };
      const { error } = await ctx.service
        .from("tenant_site_connections")
        .update({ metadata: newMeta })
        .eq("shop_id", shop_id)
        .eq("platform", "google_analytics");
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, ga4_property_id: propertyId });
    }

    const propertyId = (body?.property_id as string) ?? (metadata?.ga4_property_id as string);
    if (!propertyId) {
      return json({ error: "No GA4 property selected — call set_property first" }, 400);
    }
    const days = (body?.days as number) ?? 28;
    const dr = dateRange(days);

    if (action === "summary") {
      const data = await runReport(access_token, propertyId, {
        dateRanges: [dr],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "newUsers" },
          { name: "engagementRate" },
          { name: "conversions" },
          { name: "totalRevenue" },
          { name: "transactions" },
          { name: "averageSessionDuration" },
        ],
      });
      const m = data.totals?.[0]?.metricValues ?? [];
      return json({
        ok: true,
        range: dr,
        sessions: Number(m[0]?.value ?? 0),
        users: Number(m[1]?.value ?? 0),
        new_users: Number(m[2]?.value ?? 0),
        engagement_rate: Number(m[3]?.value ?? 0),
        conversions: Number(m[4]?.value ?? 0),
        revenue: Number(m[5]?.value ?? 0),
        transactions: Number(m[6]?.value ?? 0),
        avg_session_duration: Number(m[7]?.value ?? 0),
      });
    }

    if (action === "top_pages") {
      const limit = (body?.limit as number) ?? 25;
      const data = await runReport(access_token, propertyId, {
        dateRanges: [dr],
        dimensions: [{ name: "landingPage" }, { name: "sessionDefaultChannelGroup" }],
        metrics: [
          { name: "sessions" },
          { name: "engagementRate" },
          { name: "conversions" },
          { name: "totalRevenue" },
        ],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit,
      });
      return json({
        ok: true,
        range: dr,
        rows: (data.rows ?? []).map((r) => ({
          landing_page: r.dimensionValues[0]?.value,
          channel: r.dimensionValues[1]?.value,
          sessions: Number(r.metricValues[0]?.value ?? 0),
          engagement_rate: Number(r.metricValues[1]?.value ?? 0),
          conversions: Number(r.metricValues[2]?.value ?? 0),
          revenue: Number(r.metricValues[3]?.value ?? 0),
        })),
      });
    }

    if (action === "channels") {
      const data = await runReport(access_token, propertyId, {
        dateRanges: [dr],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "conversions" },
          { name: "totalRevenue" },
        ],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      });
      return json({
        ok: true,
        range: dr,
        rows: (data.rows ?? []).map((r) => ({
          channel: r.dimensionValues[0]?.value,
          sessions: Number(r.metricValues[0]?.value ?? 0),
          users: Number(r.metricValues[1]?.value ?? 0),
          conversions: Number(r.metricValues[2]?.value ?? 0),
          revenue: Number(r.metricValues[3]?.value ?? 0),
        })),
      });
    }

    if (action === "post_attribution") {
      const url = body?.url as string;
      if (!url) return json({ error: "url required" }, 400);
      const path = (() => {
        try {
          return new URL(url).pathname;
        } catch {
          return url;
        }
      })();
      const data = await runReport(access_token, propertyId, {
        dateRanges: [dr],
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [
          { name: "sessions" },
          { name: "totalUsers" },
          { name: "conversions" },
          { name: "totalRevenue" },
        ],
        dimensionFilter: {
          filter: {
            fieldName: "landingPage",
            stringFilter: { matchType: "EXACT", value: path },
          },
        },
      });
      return json({
        ok: true,
        path,
        range: dr,
        rows: (data.rows ?? []).map((r) => ({
          channel: r.dimensionValues[0]?.value,
          sessions: Number(r.metricValues[0]?.value ?? 0),
          users: Number(r.metricValues[1]?.value ?? 0),
          conversions: Number(r.metricValues[2]?.value ?? 0),
          revenue: Number(r.metricValues[3]?.value ?? 0),
        })),
      });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[seo-google-analytics] error", msg);
    return json({ error: msg }, 500);
  }
});
