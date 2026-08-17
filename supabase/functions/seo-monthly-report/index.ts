/**
 * seo-monthly-report — White-label monthly SEO summary as HTML.
 *
 * Action: 'generate'
 *   Body: { shop_id, month_iso }   month_iso e.g. "2026-04"
 *   Pulls (best-effort, missing connections degrade gracefully):
 *     - GSC summary + top 20 queries (28d ending in the target month)
 *     - GA4 summary + top 10 landing pages + channel breakdown (28d)
 *     - seo_audit_runs for the shop (avg score trend)
 *     - seo_blog_posts published in the month
 *   Renders a styled HTML report (shop name + logo header) and returns it.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { authenticate, assertShopMember } from "../_shared/seo/auth.ts";
import { getValidGoogleAccessToken } from "../_shared/seo/google-oauth.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface MonthRange {
  start: string;
  end: string;
  label: string;
}

function monthRange(monthIso: string): MonthRange {
  // monthIso like "2026-04" → first/last day of that month, capped to today.
  const [y, m] = monthIso.split("-").map((n) => Number(n));
  if (!y || !m || m < 1 || m > 12) throw new Error("month_iso must be YYYY-MM");
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lastDayOfMonth = new Date(Date.UTC(y, m, 0));
  const today = new Date();
  // GSC/GA4 only have data through yesterday.
  const yesterday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));
  const end = lastDayOfMonth < yesterday ? lastDayOfMonth : yesterday;
  const monthName = first.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return {
    start: first.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    label: monthName,
  };
}

function lastNDaysEndingOn(endIso: string, days: number): { start: string; end: string } {
  const end = new Date(`${endIso}T00:00:00Z`);
  const start = new Date(end.getTime() - (days - 1) * 86400_000);
  return { start: start.toISOString().slice(0, 10), end: endIso };
}

function escapeHtml(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Math.round(n).toLocaleString();
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n) || n === 0) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

interface GscRow { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }
interface GscSummary {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  topQueries: GscRow[];
}

async function fetchGscData(
  service: import("https://esm.sh/@supabase/supabase-js@2.45.0").SupabaseClient,
  shopId: string,
  range: { start: string; end: string },
): Promise<{ data?: GscSummary; error?: string }> {
  try {
    const { access_token, metadata } = await getValidGoogleAccessToken(
      service,
      shopId,
      "google_search_console",
    );
    const siteUrl = metadata?.selected_site as string | undefined;
    if (!siteUrl) return { error: "No Search Console site selected" };
    const queryRes = await fetch(
      `https://searchconsole.googleapis.com/v1/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: range.start,
          endDate: range.end,
          dimensions: ["query"],
          rowLimit: 20,
        }),
      },
    );
    if (!queryRes.ok) {
      const t = await queryRes.text();
      return { error: `GSC ${queryRes.status}: ${t.slice(0, 200)}` };
    }
    const queryData = await queryRes.json();
    const rows: GscRow[] = queryData.rows ?? [];
    const totals = rows.reduce(
      (acc, r) => {
        acc.clicks += r.clicks;
        acc.impressions += r.impressions;
        return acc;
      },
      { clicks: 0, impressions: 0 },
    );
    const overallRes = await fetch(
      `https://searchconsole.googleapis.com/v1/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: range.start,
          endDate: range.end,
          dimensions: [],
          rowLimit: 1,
        }),
      },
    );
    let overall = { clicks: totals.clicks, impressions: totals.impressions, ctr: 0, position: 0 };
    if (overallRes.ok) {
      const overallData = await overallRes.json();
      const r = overallData.rows?.[0];
      if (r) {
        overall = {
          clicks: r.clicks ?? totals.clicks,
          impressions: r.impressions ?? totals.impressions,
          ctr: r.ctr ?? 0,
          position: r.position ?? 0,
        };
      }
    }
    return { data: { ...overall, topQueries: rows } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

interface Ga4Summary {
  sessions: number;
  users: number;
  conversions: number;
  revenue: number;
  transactions: number;
  engagementRate: number;
  topPages: Array<{ page: string; channel: string; sessions: number; conversions: number; revenue: number }>;
  channels: Array<{ channel: string; sessions: number; users: number; conversions: number; revenue: number }>;
}

async function fetchGa4Data(
  service: import("https://esm.sh/@supabase/supabase-js@2.45.0").SupabaseClient,
  shopId: string,
  range: { start: string; end: string },
): Promise<{ data?: Ga4Summary; error?: string }> {
  try {
    const { access_token, metadata } = await getValidGoogleAccessToken(
      service,
      shopId,
      "google_analytics",
    );
    const propertyId = metadata?.ga4_property_id as string | undefined;
    if (!propertyId) return { error: "No GA4 property selected" };

    const baseUrl = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
    const headers = {
      Authorization: `Bearer ${access_token}`,
      "Content-Type": "application/json",
    };
    const dateRange = { startDate: range.start, endDate: range.end };

    const [sumRes, pagesRes, channelsRes] = await Promise.all([
      fetch(baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          dateRanges: [dateRange],
          metrics: [
            { name: "sessions" }, { name: "totalUsers" }, { name: "conversions" },
            { name: "totalRevenue" }, { name: "transactions" }, { name: "engagementRate" },
          ],
        }),
      }),
      fetch(baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          dateRanges: [dateRange],
          dimensions: [{ name: "landingPage" }, { name: "sessionDefaultChannelGroup" }],
          metrics: [
            { name: "sessions" }, { name: "conversions" }, { name: "totalRevenue" },
          ],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit: 10,
        }),
      }),
      fetch(baseUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          dateRanges: [dateRange],
          dimensions: [{ name: "sessionDefaultChannelGroup" }],
          metrics: [
            { name: "sessions" }, { name: "totalUsers" },
            { name: "conversions" }, { name: "totalRevenue" },
          ],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        }),
      }),
    ]);

    if (!sumRes.ok || !pagesRes.ok || !channelsRes.ok) {
      const txt = await (sumRes.ok ? (pagesRes.ok ? channelsRes : pagesRes) : sumRes).text();
      return { error: `GA4 ${txt.slice(0, 200)}` };
    }

    const sumData = await sumRes.json();
    const pagesData = await pagesRes.json();
    const channelsData = await channelsRes.json();
    const m = sumData.totals?.[0]?.metricValues ?? [];

    return {
      data: {
        sessions: Number(m[0]?.value ?? 0),
        users: Number(m[1]?.value ?? 0),
        conversions: Number(m[2]?.value ?? 0),
        revenue: Number(m[3]?.value ?? 0),
        transactions: Number(m[4]?.value ?? 0),
        engagementRate: Number(m[5]?.value ?? 0),
        topPages: (pagesData.rows ?? []).map((r: { dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> }) => ({
          page: r.dimensionValues[0]?.value ?? "/",
          channel: r.dimensionValues[1]?.value ?? "—",
          sessions: Number(r.metricValues[0]?.value ?? 0),
          conversions: Number(r.metricValues[1]?.value ?? 0),
          revenue: Number(r.metricValues[2]?.value ?? 0),
        })),
        channels: (channelsData.rows ?? []).map((r: { dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> }) => ({
          channel: r.dimensionValues[0]?.value ?? "—",
          sessions: Number(r.metricValues[0]?.value ?? 0),
          users: Number(r.metricValues[1]?.value ?? 0),
          conversions: Number(r.metricValues[2]?.value ?? 0),
          revenue: Number(r.metricValues[3]?.value ?? 0),
        })),
      },
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

interface ReportData {
  shop: { name: string; logo_url: string | null };
  monthLabel: string;
  range: { start: string; end: string };
  gsc: GscSummary | null;
  gscError: string | null;
  ga4: Ga4Summary | null;
  ga4Error: string | null;
  audits: { runs: number; avgScore: number | null; lastScore: number | null };
  blogPosts: Array<{ title: string; url: string | null; published_at: string }>;
}

function renderHtml(d: ReportData): string {
  const css = `
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; color: #111; background: #fafafa; }
    .container { max-width: 800px; margin: 0 auto; padding: 32px 28px; background: #fff; }
    header { display: flex; align-items: center; gap: 16px; padding-bottom: 18px; border-bottom: 2px solid #00C7FF; margin-bottom: 24px; }
    header img { height: 48px; max-width: 180px; object-fit: contain; }
    h1 { font-size: 24px; margin: 0; }
    h2 { font-size: 16px; text-transform: uppercase; letter-spacing: 0.04em; color: #555; margin: 28px 0 8px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
    h3 { margin: 16px 0 8px; font-size: 14px; }
    p { line-height: 1.55; font-size: 13px; color: #333; }
    .subtitle { color: #777; font-size: 13px; margin-top: 4px; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 12px 0; }
    .metric { background: #f6fbff; border: 1px solid #d9eefc; border-radius: 8px; padding: 12px; }
    .metric .label { font-size: 10px; text-transform: uppercase; color: #557; letter-spacing: 0.05em; }
    .metric .value { font-size: 20px; font-weight: 600; color: #003a55; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
    th { text-align: left; padding: 6px 8px; background: #f3f5f8; color: #444; font-weight: 600; border-bottom: 1px solid #ddd; }
    td { padding: 6px 8px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #eef; color: #225; font-size: 11px; }
    .empty { color: #888; font-style: italic; font-size: 12px; padding: 8px 0; }
    .error { color: #b34; font-size: 12px; background: #fff5f5; border: 1px solid #fdd; padding: 6px 10px; border-radius: 6px; }
    footer { margin-top: 32px; padding-top: 14px; border-top: 1px solid #eee; color: #888; font-size: 11px; text-align: center; }
    @media print { body { background: #fff; } .container { padding: 0; } }
  `;
  const logo = d.shop.logo_url
    ? `<img src="${escapeHtml(d.shop.logo_url)}" alt="${escapeHtml(d.shop.name)}" />`
    : "";
  const gscBlock = d.gsc
    ? `
      <div class="grid">
        <div class="metric"><div class="label">Clicks</div><div class="value">${fmtNumber(d.gsc.clicks)}</div></div>
        <div class="metric"><div class="label">Impressions</div><div class="value">${fmtNumber(d.gsc.impressions)}</div></div>
        <div class="metric"><div class="label">Avg position</div><div class="value">${d.gsc.position ? d.gsc.position.toFixed(1) : "—"}</div></div>
      </div>
      <h3>Top queries</h3>
      ${d.gsc.topQueries.length === 0
        ? `<div class="empty">No queries yet for this period.</div>`
        : `
          <table>
            <thead><tr><th>Query</th><th class="num">Clicks</th><th class="num">Impr.</th><th class="num">CTR</th><th class="num">Pos.</th></tr></thead>
            <tbody>
              ${d.gsc.topQueries.map((r) => `
                <tr>
                  <td>${escapeHtml(r.keys[0])}</td>
                  <td class="num">${fmtNumber(r.clicks)}</td>
                  <td class="num">${fmtNumber(r.impressions)}</td>
                  <td class="num">${fmtPct(r.ctr)}</td>
                  <td class="num">${r.position?.toFixed(1) ?? "—"}</td>
                </tr>`).join("")}
            </tbody>
          </table>`}
    `
    : `<div class="error">Search Console: ${escapeHtml(d.gscError ?? "not connected")}</div>`;

  const ga4Block = d.ga4
    ? `
      <div class="grid">
        <div class="metric"><div class="label">Sessions</div><div class="value">${fmtNumber(d.ga4.sessions)}</div></div>
        <div class="metric"><div class="label">Users</div><div class="value">${fmtNumber(d.ga4.users)}</div></div>
        <div class="metric"><div class="label">Conversions</div><div class="value">${fmtNumber(d.ga4.conversions)}</div></div>
        <div class="metric"><div class="label">Revenue</div><div class="value">${fmtUsd(d.ga4.revenue)}</div></div>
        <div class="metric"><div class="label">Transactions</div><div class="value">${fmtNumber(d.ga4.transactions)}</div></div>
        <div class="metric"><div class="label">Engagement</div><div class="value">${fmtPct(d.ga4.engagementRate)}</div></div>
      </div>
      <h3>Top landing pages</h3>
      ${d.ga4.topPages.length === 0
        ? `<div class="empty">No landing-page data yet.</div>`
        : `
          <table>
            <thead><tr><th>Page</th><th>Channel</th><th class="num">Sessions</th><th class="num">Conv.</th><th class="num">Revenue</th></tr></thead>
            <tbody>
              ${d.ga4.topPages.map((r) => `
                <tr>
                  <td><code>${escapeHtml(r.page)}</code></td>
                  <td><span class="pill">${escapeHtml(r.channel)}</span></td>
                  <td class="num">${fmtNumber(r.sessions)}</td>
                  <td class="num">${fmtNumber(r.conversions)}</td>
                  <td class="num">${fmtUsd(r.revenue)}</td>
                </tr>`).join("")}
            </tbody>
          </table>`}
      <h3>Channel breakdown</h3>
      ${d.ga4.channels.length === 0
        ? `<div class="empty">No channel data yet.</div>`
        : `
          <table>
            <thead><tr><th>Channel</th><th class="num">Sessions</th><th class="num">Users</th><th class="num">Conv.</th><th class="num">Revenue</th></tr></thead>
            <tbody>
              ${d.ga4.channels.map((r) => `
                <tr>
                  <td>${escapeHtml(r.channel)}</td>
                  <td class="num">${fmtNumber(r.sessions)}</td>
                  <td class="num">${fmtNumber(r.users)}</td>
                  <td class="num">${fmtNumber(r.conversions)}</td>
                  <td class="num">${fmtUsd(r.revenue)}</td>
                </tr>`).join("")}
            </tbody>
          </table>`}
    `
    : `<div class="error">Analytics: ${escapeHtml(d.ga4Error ?? "not connected")}</div>`;

  const auditBlock = d.audits.runs === 0
    ? `<div class="empty">No audits run for this shop yet.</div>`
    : `
      <div class="grid">
        <div class="metric"><div class="label">Audits run</div><div class="value">${fmtNumber(d.audits.runs)}</div></div>
        <div class="metric"><div class="label">Avg score</div><div class="value">${d.audits.avgScore !== null ? d.audits.avgScore : "—"}</div></div>
        <div class="metric"><div class="label">Latest score</div><div class="value">${d.audits.lastScore !== null ? d.audits.lastScore : "—"}</div></div>
      </div>
    `;

  const blogBlock = d.blogPosts.length === 0
    ? `<div class="empty">No posts published in ${escapeHtml(d.monthLabel)}.</div>`
    : `
      <ul style="font-size:13px;padding-left:18px;margin:8px 0;">
        ${d.blogPosts.map((p) => `
          <li style="margin-bottom:6px;">
            ${p.url
              ? `<a href="${escapeHtml(p.url)}" target="_blank">${escapeHtml(p.title)}</a>`
              : escapeHtml(p.title)}
            <span style="color:#888;font-size:11px;"> — ${escapeHtml(new Date(p.published_at).toLocaleDateString())}</span>
          </li>`).join("")}
      </ul>
    `;

  return `<!doctype html>
<html><head><meta charset="utf-8" />
<title>${escapeHtml(d.shop.name)} — SEO report ${escapeHtml(d.monthLabel)}</title>
<style>${css}</style>
</head>
<body>
  <div class="container">
    <header>
      ${logo}
      <div>
        <h1>${escapeHtml(d.shop.name)}</h1>
        <div class="subtitle">SEO report — ${escapeHtml(d.monthLabel)} (${escapeHtml(d.range.start)} → ${escapeHtml(d.range.end)})</div>
      </div>
    </header>

    <h2>Search Console</h2>
    ${gscBlock}

    <h2>Traffic & revenue (GA4)</h2>
    ${ga4Block}

    <h2>On-page audits</h2>
    ${auditBlock}

    <h2>Content published</h2>
    ${blogBlock}

    <footer>Generated by RestylePro SEO · ${escapeHtml(new Date().toLocaleString())}</footer>
  </div>
</body></html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const ctx = await authenticate(req);
    const body = await req.json();
    const action = body?.action as string;
    const shop_id = body?.shop_id as string;
    if (action !== "generate") return json({ error: `Unknown action: ${action}` }, 400);
    if (!shop_id) return json({ error: "shop_id required" }, 400);
    await assertShopMember(ctx, shop_id);

    const monthIso = (body?.month_iso as string) ?? new Date().toISOString().slice(0, 7);
    const range = monthRange(monthIso);
    const window28 = lastNDaysEndingOn(range.end, 28);

    const { data: shopRow } = await ctx.service
      .from("shops")
      .select("name, logo_url")
      .eq("id", shop_id)
      .maybeSingle();
    const shop = {
      name: shopRow?.name ?? "Shop",
      logo_url: shopRow?.logo_url ?? null,
    };

    // Run GSC + GA4 + db queries in parallel.
    const [gscRes, ga4Res, auditsRes, postsRes] = await Promise.all([
      fetchGscData(ctx.service, shop_id, window28),
      fetchGa4Data(ctx.service, shop_id, window28),
      ctx.service
        .from("seo_audit_runs")
        .select("score, ran_at")
        .eq("shop_id", shop_id)
        .gte("ran_at", `${range.start}T00:00:00Z`)
        .lte("ran_at", `${range.end}T23:59:59Z`)
        .order("ran_at", { ascending: false })
        .limit(500),
      ctx.service
        .from("seo_blog_posts")
        .select("title, external_url, published_at")
        .eq("shop_id", shop_id)
        .eq("status", "published")
        .gte("published_at", `${range.start}T00:00:00Z`)
        .lte("published_at", `${range.end}T23:59:59Z`)
        .order("published_at", { ascending: false }),
    ]);

    const auditRows = (auditsRes.data ?? []) as Array<{ score: number | null; ran_at: string }>;
    const scores = auditRows.map((r) => r.score).filter((s): s is number => typeof s === "number");
    const avgScore = scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : null;
    const lastScore = auditRows[0]?.score ?? null;

    const blogPosts = ((postsRes.data ?? []) as Array<{ title: string; external_url: string | null; published_at: string }>)
      .map((p) => ({
        title: p.title || "(untitled)",
        url: p.external_url,
        published_at: p.published_at,
      }));

    const html = renderHtml({
      shop,
      monthLabel: range.label,
      range: { start: range.start, end: range.end },
      gsc: gscRes.data ?? null,
      gscError: gscRes.error ?? null,
      ga4: ga4Res.data ?? null,
      ga4Error: ga4Res.error ?? null,
      audits: { runs: auditRows.length, avgScore, lastScore },
      blogPosts,
    });

    return json({
      ok: true,
      month_iso: monthIso,
      range,
      html,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[seo-monthly-report] error", msg);
    return json({ error: msg }, 500);
  }
});
