// meta-ads-report — pulls live Meta (Facebook/Instagram) ad performance
// from the Graph Marketing API so the AI Workforce can see paid-traffic
// health (the driver of order VOLUME, which the Woo data shows is what's
// down). Read-only: spend, ROAS, CPA, CTR, frequency, purchases by
// campaign for a date range.
//
// MULTI-BRAND (2026-08-13). The original resolver was single-account: one
// token, one ad account, and an explicit "Multiple shops have Meta ad
// accounts connected — pass shop_id" refusal. That shape cannot answer
// "which of my brands should I switch ads on", because brands here are a
// `brand` STRING (slack_agent_tasks.brand), not a shop_id — the two
// keyspaces never lined up.
//
// VERIFIED LAYOUT (owner's Business Manager, read off the console
// 2026-08-13 — this replaces an earlier "all one Business Manager"
// assumption in this file that the console disproved):
//
//   Restyleproai      2218672108481031  → RestyleProAI    1239092194363909
//   We Print Wraps®   629261264127712   → WePrintWraps 2  23852489112300657
//                                       → We Print Wraps
//
// Two facts fall out of that, and both are why the map is shaped the way
// it is rather than a flat brand -> id:
//
//   1. The accounts span TWO portfolios. A system user belongs to ONE
//      portfolio and can only be assigned that portfolio's accounts, so a
//      single shared token cannot read both. Hence the per-brand token
//      override below.
//   2. One brand owns MORE THAN ONE ad account. A single id per brand
//      cannot express that, and picking one silently would under-report
//      that brand's spend — the exact error that makes a "switch this ad
//      out" call wrong. Hence a brand may map to a LIST.
//
//   META_ADS_ACCOUNT_MAP — JSON, brand slug -> ad account id, or a LIST of
//     ids when a brand runs several accounts. Both forms are accepted:
//       {"weprintwraps":["23852489112300657","..."],
//        "restylepro":"1239092194363909"}
//   META_ACCESS_TOKEN    — the default system-user token.
//   META_ACCESS_TOKEN_<BRAND> — optional per-brand override, used when that
//     brand's accounts live in a different portfolio than the default
//     token's. Brand slug upper-cased, non-alphanumerics to underscore:
//     weprintwraps -> META_ACCESS_TOKEN_WEPRINTWRAPS.
//
// A system-user token is the right credential here: it does not expire,
// where the per-user OAuth token dies every ~60 days and takes every brand
// dark silently with it.
//
// Credentials resolve in this order:
//   1. brand + META_ADS_ACCOUNT_MAP + a token for that brand  (multi-brand)
//   2. The shop's Meta OAuth connection (tenant_site_connections,
//      platform=meta_facebook) — connected on /admin/seo/connections with
//      the ad account chosen via the picker (config.ad_account_id).
//      Pass shop_id when more than one shop has a connection. Kept so a
//      third-party shop that connects its own Meta still reports.
//   3. Env-secret fallback (set via the set-fn-secret workflow — NEVER in
//      chat/code): META_ACCESS_TOKEN (ads_read) + META_AD_ACCOUNT_ID
//      (digits only, no "act_").
//
// Call one brand:   POST { "brand": "weprintwraps", "date_preset": "last_30d" }
// Call every brand: POST { "all_brands": true, "date_preset": "last_30d" }
// Legacy (single):  POST { "date_preset": "last_30d" }
//
// The single-brand response shape is UNCHANGED (ok/range/totals/campaigns)
// because marketing-agent's ads_audit reads those fields directly. The
// all-brands response is a different shape (brands[] + rollup) and callers
// opt into it explicitly.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GRAPH = "https://graph.facebook.com/v21.0";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// accts is a LIST because a brand may run several ad accounts; the legacy
// resolvers simply return a single-element list.
type MetaCreds = { token: string; accts: string[]; source: "brand_map" | "connection" | "env" };

// Brand slug -> ad account ids. A value may be a single id or a list, since
// one brand can run several accounts (WePrintWraps runs two). Malformed JSON
// returns {} rather than throwing: a typo'd secret must degrade to "no brands
// configured", never 500 the whole report and take the healthy resolvers down
// with it.
function brandAccountMap(): Record<string, string[]> {
  const raw = Deno.env.get("META_ADS_ACCOUNT_MAP");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string[]> = {};
    for (const [brand, value] of Object.entries(parsed as Record<string, unknown>)) {
      const ids = (Array.isArray(value) ? value : [value])
        .map((v) => String(v ?? "").trim())
        .filter(Boolean);
      if (ids.length) out[brand.trim().toLowerCase()] = ids;
    }
    return out;
  } catch {
    return {};
  }
}

// The token that can read THIS brand's accounts. A system user belongs to one
// portfolio, so brands whose accounts sit in a different portfolio than the
// default token's need their own — set META_ACCESS_TOKEN_<BRAND> for those.
function tokenForBrand(brand: string): string | undefined {
  const suffix = brand.trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return Deno.env.get(`META_ACCESS_TOKEN_${suffix}`) ?? Deno.env.get("META_ACCESS_TOKEN");
}

async function resolveCreds(shopId?: string, brand?: string): Promise<MetaCreds | { error: string }> {
  // 1. Brand map — the multi-brand path.
  if (brand) {
    const map = brandAccountMap();
    const key = brand.trim().toLowerCase();
    const accts = map[key];
    const token = tokenForBrand(key);
    if (accts && token) return { token, accts, source: "brand_map" };
    if (accts && !token) {
      return {
        error: `Brand "${brand}" is mapped to an ad account but no token is set for it. ` +
          `Set META_ACCESS_TOKEN (or META_ACCESS_TOKEN_${key.toUpperCase().replace(/[^A-Z0-9]/g, "_")} ` +
          `if its accounts are in a different Business portfolio) via the 'Set Function Secret' ` +
          `GitHub workflow (never paste tokens in chat).`,
      };
    }
    const known = Object.keys(map);
    if (known.length) {
      return {
        error: `Brand "${brand}" is not in META_ADS_ACCOUNT_MAP. Mapped brands: ${known.join(", ")}.`,
      };
    }
    // No map configured at all — fall through to the legacy resolvers so an
    // existing single-account setup keeps working when a brand is passed.
  }

  // 2. Per-shop OAuth connection.
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (url && key) {
    const svc = createClient(url, key, { auth: { persistSession: false } });
    let q = svc
      .from("tenant_site_connections")
      .select("shop_id, config")
      .eq("platform", "meta_facebook")
      .eq("is_active", true);
    if (shopId) q = q.eq("shop_id", shopId);
    const { data } = await q;
    const withAds = (data ?? []).filter(
      (r) => (r.config as { ad_account_id?: string })?.ad_account_id &&
        (r.config as { user_access_token?: string })?.user_access_token,
    );
    if (withAds.length > 1 && !shopId) {
      return { error: "Multiple shops have Meta ad accounts connected — pass shop_id." };
    }
    if (withAds.length === 1) {
      const cfg = withAds[0].config as { user_access_token: string; ad_account_id: string };
      return { token: cfg.user_access_token, accts: [cfg.ad_account_id], source: "connection" };
    }
  }

  // 3. Single-account env fallback.
  const token = Deno.env.get("META_ACCESS_TOKEN");
  const acct = Deno.env.get("META_AD_ACCOUNT_ID");
  if (token && acct) return { token, accts: [acct], source: "env" };

  return {
    error: "No Meta ad account resolved. Either set META_ACCESS_TOKEN + META_ADS_ACCOUNT_MAP " +
      "(brand -> ad account id) for multi-brand reporting, connect Meta on " +
      "/admin/seo/connections and pick an ad account, or set META_ACCESS_TOKEN + " +
      "META_AD_ACCOUNT_ID via the 'Set Function Secret' GitHub workflow " +
      "(never paste tokens in chat).",
  };
}

// Live creative images for ad-level rows so the report shows WHICH image is
// fatigued/weak, not just its name. Best-effort: a creative fetch failure
// never fails the report — rows just come back without an image.
type CreativeInfo = { image: string | null; thumbnail: string | null; status: string | null };

async function fetchCreatives(adIds: string[], token: string): Promise<Record<string, CreativeInfo>> {
  const out: Record<string, CreativeInfo> = {};
  for (let i = 0; i < adIds.length; i += 50) {
    const params = new URLSearchParams({
      ids: adIds.slice(i, i + 50).join(","),
      fields: "effective_status,creative.thumbnail_width(512).thumbnail_height(512){thumbnail_url,image_url}",
      access_token: token,
    });
    try {
      const res = await fetch(`${GRAPH}/?${params.toString()}`);
      const data = await res.json();
      if (!res.ok || data.error) continue;
      for (const [id, ad] of Object.entries(data as Record<string, { effective_status?: string; creative?: { thumbnail_url?: string; image_url?: string } }>)) {
        const c = ad?.creative ?? {};
        out[id] = {
          image: c.image_url ?? c.thumbnail_url ?? null,
          thumbnail: c.thumbnail_url ?? c.image_url ?? null,
          status: ad?.effective_status ?? null,
        };
      }
    } catch { /* best-effort */ }
  }
  return out;
}

type ReportOpts = { level: string; since?: string; until?: string; datePreset: string };
type AccountReport = {
  totals: Record<string, number | null>;
  campaigns: Record<string, unknown>[];
};

// One account's insights, normalized. Throws on a Graph error so per-brand
// callers can record the failure against that brand instead of losing the
// whole run.
async function fetchAccountReport(token: string, acct: string, opts: ReportOpts): Promise<AccountReport> {
  const fields = [
    // campaign_id is what the pause/resume control acts on. Without it the
    // only handle on a campaign is its NAME, and pausing by name means
    // resolving a human string back to an object — the kind of lookup that
    // pauses the wrong campaign the first time two share a prefix.
    "campaign_id",
    "campaign_name",
    ...(opts.level === "adset" || opts.level === "ad" ? ["adset_name"] : []),
    ...(opts.level === "ad" ? ["ad_name", "ad_id"] : []),
    "spend", "impressions", "clicks", "ctr", "cpc", "frequency",
    "reach", "purchase_roas", "actions", "action_values",
  ].join(",");

  const params = new URLSearchParams({ level: opts.level, fields, limit: "200", access_token: token });
  if (opts.since && opts.until) {
    params.set("time_range", JSON.stringify({ since: opts.since, until: opts.until }));
  } else {
    params.set("date_preset", opts.datePreset);
  }

  const acctId = acct.startsWith("act_") ? acct : `act_${acct}`;
  const res = await fetch(`${GRAPH}/${acctId}/insights?${params.toString()}`);
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || `graph ${res.status}`);
  }

  const rows = (data.data ?? []).map((r: Record<string, unknown>) => {
    const purchases = (r.actions as { action_type: string; value: string }[] ?? [])
      .find((a) => a.action_type === "purchase" || a.action_type === "omni_purchase");
    const purchaseValue = (r.action_values as { action_type: string; value: string }[] ?? [])
      .find((a) => a.action_type === "purchase" || a.action_type === "omni_purchase");
    const roas = (r.purchase_roas as { value: string }[] ?? [])[0]?.value ?? null;
    const spend = Number(r.spend ?? 0);
    const purch = Number(purchases?.value ?? 0);
    return {
      campaign: r.campaign_name ?? "(account)",
      ...(r.campaign_id ? { campaign_id: String(r.campaign_id) } : {}),
      ...(r.adset_name ? { adset: r.adset_name } : {}),
      ...(r.ad_name ? { ad: r.ad_name } : {}),
      ...(r.ad_id ? { ad_id: r.ad_id } : {}),
      spend: +spend.toFixed(2),
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
      ctr: r.ctr ? +Number(r.ctr).toFixed(2) : null,           // %
      cpc: r.cpc ? +Number(r.cpc).toFixed(2) : null,
      frequency: r.frequency ? +Number(r.frequency).toFixed(2) : null, // >3-4 = fatigue
      reach: Number(r.reach ?? 0),
      roas: roas ? +Number(roas).toFixed(2) : null,
      purchases: purch,
      purchase_value: +Number(purchaseValue?.value ?? 0).toFixed(2),
      cpa: purch > 0 ? +(spend / purch).toFixed(2) : null,     // cost per purchase
    };
  });

  // Attach live creative images at ad level (which picture is running).
  if (opts.level === "ad") {
    const ids = rows.map((r: { ad_id?: string }) => r.ad_id).filter(Boolean) as string[];
    if (ids.length) {
      const creatives = await fetchCreatives(ids, token);
      for (const r of rows as ({ ad_id?: string } & Partial<CreativeInfo>)[]) {
        const c = r.ad_id ? creatives[r.ad_id] : undefined;
        r.image = c?.image ?? null;
        r.thumbnail = c?.thumbnail ?? null;
        r.status = c?.status ?? null;
      }
    }
  }

  const totals = rows.reduce((t: Record<string, number>, r: Record<string, number>) => ({
    spend: (t.spend ?? 0) + (r.spend || 0),
    purchases: (t.purchases ?? 0) + (r.purchases || 0),
    purchase_value: (t.purchase_value ?? 0) + (r.purchase_value || 0),
  }), {} as Record<string, number>);
  const blendedRoas = totals.spend > 0 ? +((totals.purchase_value || 0) / totals.spend).toFixed(2) : null;

  return {
    totals: { ...totals, blended_roas: blendedRoas },
    campaigns: rows.sort((a: Record<string, number>, b: Record<string, number>) => (b.spend || 0) - (a.spend || 0)),
  };
}

// One BRAND's report across ALL of its ad accounts. Rows are concatenated and
// totals re-summed, so a brand running two accounts reports its real spend
// rather than whichever account happened to be listed first — under-reporting
// a brand's spend is exactly what makes a "switch this ad out" call wrong.
async function fetchBrandReport(token: string, accts: string[], opts: ReportOpts): Promise<AccountReport> {
  if (accts.length === 1) return fetchAccountReport(token, accts[0], opts);
  const parts = await Promise.all(accts.map((a) => fetchAccountReport(token, a, opts)));
  const campaigns = parts
    .flatMap((p) => p.campaigns)
    .sort((a, b) => Number((b as { spend?: number }).spend ?? 0) - Number((a as { spend?: number }).spend ?? 0));
  const spend = +parts.reduce((t, p) => t + Number(p.totals.spend ?? 0), 0).toFixed(2);
  const purchases = parts.reduce((t, p) => t + Number(p.totals.purchases ?? 0), 0);
  const purchaseValue = +parts.reduce((t, p) => t + Number(p.totals.purchase_value ?? 0), 0).toFixed(2);
  return {
    totals: {
      spend,
      purchases,
      purchase_value: purchaseValue,
      blended_roas: spend > 0 ? +(purchaseValue / spend).toFixed(2) : null,
    },
    campaigns,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  let body: {
    date_preset?: string;
    since?: string;
    until?: string;
    level?: string;
    shop_id?: string;
    brand?: string;
    all_brands?: boolean;
    action?: string;
    campaign_id?: string;
  } = {};
  try { body = await req.json(); } catch { /* defaults */ }

  const opts: ReportOpts = {
    level: body.level || "campaign",
    since: body.since,
    until: body.until,
    datePreset: body.date_preset || "last_30d",
  };
  const range = body.since && body.until ? `${body.since}..${body.until}` : opts.datePreset;

  // ── ALL-BRANDS ROLLUP ───────────────────────────────────────────────────
  // Every mapped brand in one pass. A brand whose Graph call fails is
  // reported as ok:false against that brand and does NOT abort the others —
  // one disabled ad account must never hide the other five brands' numbers.
  if (body.all_brands || body.brand === "all") {
    const map = brandAccountMap();
    const brands = Object.keys(map);
    if (!brands.length) {
      return json({
        ok: false,
        error: "META_ADS_ACCOUNT_MAP is not set (or is empty). Set it via the 'Set Function Secret' " +
          "workflow as JSON mapping brand slug -> ad account id, e.g. " +
          `{"weprintwraps":"1234567890","restylepro":"2345678901"}.`,
      }, 400);
    }
    // Token is resolved PER BRAND, not once: the accounts span two Business
    // portfolios and a system user only reaches its own portfolio's accounts.
    const results = await Promise.all(brands.map(async (brand) => {
      const failed = (error: string) => ({
        brand,
        ad_account_ids: map[brand],
        ok: false as const,
        error,
        totals: { spend: 0, purchases: 0, purchase_value: 0, blended_roas: null },
        campaigns: [] as Record<string, unknown>[],
      });
      const token = tokenForBrand(brand);
      if (!token) {
        return failed(
          `No token set for "${brand}" — set META_ACCESS_TOKEN_${brand.toUpperCase().replace(/[^A-Z0-9]/g, "_")} ` +
            `(or META_ACCESS_TOKEN) via the 'Set Function Secret' workflow.`,
        );
      }
      try {
        const report = await fetchBrandReport(token, map[brand], opts);
        return { brand, ad_account_ids: map[brand], ok: true as const, ...report };
      } catch (e) {
        return failed(e instanceof Error ? e.message : String(e));
      }
    }));

    const rollup = results.reduce((t, r) => ({
      spend: +(t.spend + Number(r.totals.spend ?? 0)).toFixed(2),
      purchases: t.purchases + Number(r.totals.purchases ?? 0),
      purchase_value: +(t.purchase_value + Number(r.totals.purchase_value ?? 0)).toFixed(2),
    }), { spend: 0, purchases: 0, purchase_value: 0 });

    return json({
      ok: true,
      credential_source: "brand_map",
      range,
      brands_reported: results.filter((r) => r.ok).map((r) => r.brand),
      brands_failed: results
        .filter((r): r is Extract<typeof r, { ok: false }> => !r.ok)
        .map((r) => ({ brand: r.brand, error: r.error })),
      rollup: {
        ...rollup,
        blended_roas: rollup.spend > 0 ? +(rollup.purchase_value / rollup.spend).toFixed(2) : null,
      },
      // Biggest spender first — that is where a swap decision matters most.
      brands: results.sort((a, b) => Number(b.totals.spend ?? 0) - Number(a.totals.spend ?? 0)),
    });
  }

  // ── CONTROL: pause / resume a campaign ──────────────────────────────────
  // The ONE write path to Meta in this codebase. It lives here rather than in
  // a separate function because this file already owns brand -> account ->
  // token resolution, and a second copy of that logic is a second thing to
  // drift: a control that resolved credentials differently from the report
  // could act on an account the report never showed.
  //
  // It is deliberately dumb. It takes a campaign_id the caller already has
  // from a report row and flips status. It does not search by name, does not
  // choose what to pause, and has no thresholds of its own — the decision is
  // made and human-approved upstream in ads-proposals, and this only carries
  // it out. Anything smarter here would be a second place that can decide to
  // pause a campaign.
  if (body.action === "pause_campaign" || body.action === "resume_campaign") {
    const campaignId = String(body.campaign_id || "").trim();
    const brand = String(body.brand || "").trim();
    if (!campaignId) return json({ ok: false, error: "campaign_id required" }, 400);
    if (!/^\d+$/.test(campaignId)) {
      return json({ ok: false, error: "campaign_id must be numeric" }, 400);
    }
    if (!brand) return json({ ok: false, error: "brand required (resolves which token to use)" }, 400);

    const creds = await resolveCreds(undefined, brand);
    if ("error" in creds) return json({ ok: false, error: creds.error }, 400);

    const status = body.action === "pause_campaign" ? "PAUSED" : "ACTIVE";
    const res = await fetch(`${GRAPH}/${campaignId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ status, access_token: creds.token }).toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      return json({
        ok: false,
        error: data.error?.message || `graph ${res.status}`,
        detail: data.error ?? null,
        campaign_id: campaignId,
        attempted_status: status,
      }, 502);
    }
    return json({ ok: true, campaign_id: campaignId, status, brand });
  }

  // PAUSE ONE AD, not its campaign. The campaign switch is far too blunt for
  // the case that actually comes up: a single worn-out or out-of-season
  // creative inside a campaign that is performing. Retiring one 4th-of-July
  // ad must never be able to take a $6,000/month campaign down with it, and
  // with only pause_campaign available that was the sole way to do it.
  //
  // Same shape and same rules as the campaign switch — no thresholds here,
  // no opinion about WHICH ad. The decision is made and approved upstream.
  if (body.action === "pause_ad" || body.action === "resume_ad") {
    const adId = String(body.ad_id || "").trim();
    const brand = String(body.brand || "").trim();
    if (!adId) return json({ ok: false, error: "ad_id required" }, 400);
    if (!/^\d+$/.test(adId)) return json({ ok: false, error: "ad_id must be numeric" }, 400);
    if (!brand) return json({ ok: false, error: "brand required (resolves which token to use)" }, 400);

    const creds = await resolveCreds(undefined, brand);
    if ("error" in creds) return json({ ok: false, error: creds.error }, 400);

    const status = body.action === "pause_ad" ? "PAUSED" : "ACTIVE";
    const res = await fetch(`${GRAPH}/${adId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ status, access_token: creds.token }).toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      return json({
        ok: false,
        error: data.error?.message || `graph ${res.status}`,
        detail: data.error ?? null,
        ad_id: adId,
        attempted_status: status,
      }, 502);
    }
    // Read the ad back. "The POST returned 200" is not the same claim as
    // "the ad is off", and only the second one is worth reporting.
    let verified: string | null = null;
    try {
      const check = await fetch(
        `${GRAPH}/${adId}?fields=name,effective_status,status&access_token=${encodeURIComponent(creds.token)}`,
      );
      const c = await check.json();
      verified = c?.effective_status ?? c?.status ?? null;
    } catch { /* verification is best-effort; the write already succeeded */ }
    return json({ ok: true, ad_id: adId, status, effective_status: verified, brand });
  }

  // ── SINGLE ACCOUNT (shape unchanged for existing callers) ───────────────
  const creds = await resolveCreds(body.shop_id, body.brand);
  if ("error" in creds) return json({ ok: false, error: creds.error }, 400);
  const { token, accts } = creds;

  let report: AccountReport;
  try {
    report = await fetchBrandReport(token, accts, opts);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 502);
  }

  return json({
    ok: true,
    credential_source: creds.source,
    ...(body.brand ? { brand: body.brand, ad_account_ids: accts } : {}),
    range,
    totals: report.totals,
    campaigns: report.campaigns,
  });
});
