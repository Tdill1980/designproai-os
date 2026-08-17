/**
 * seo-pagespeed — Wrapper around Google's PageSpeed Insights API (free).
 *
 * Body: { shop_id, url, strategy?: 'mobile' | 'desktop' }
 *
 * Returns: Core Web Vitals + Lighthouse scores + top opportunities.
 *
 * Set GOOGLE_PAGESPEED_API_KEY in Supabase secrets. The API works without
 * a key but is heavily throttled.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { authenticate, assertShopMember } from "../_shared/seo/auth.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface PSIAudit {
  id: string;
  title: string;
  description?: string;
  score: number | null;
  numericValue?: number;
  displayValue?: string;
  details?: { overallSavingsMs?: number };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const ctx = await authenticate(req);
    const body = await req.json();
    const shop_id = body?.shop_id as string;
    const url = body?.url as string;
    const strategy = (body?.strategy as "mobile" | "desktop") ?? "mobile";

    if (!shop_id || !url) return json({ error: "shop_id + url required" }, 400);
    await assertShopMember(ctx, shop_id);

    const apiKey = Deno.env.get("GOOGLE_PAGESPEED_API_KEY");
    const params = new URLSearchParams({
      url,
      strategy,
      category: "performance",
    });
    params.append("category", "seo");
    params.append("category", "accessibility");
    params.append("category", "best-practices");
    if (apiKey) params.set("key", apiKey);

    const res = await fetch(
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`,
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return json({ error: `PageSpeed API ${res.status}: ${txt.slice(0, 400)}` }, 502);
    }
    const data = await res.json();
    const lighthouse = data?.lighthouseResult;

    const categories = lighthouse?.categories ?? {};
    const audits = (lighthouse?.audits ?? {}) as Record<string, PSIAudit>;

    function metric(id: string) {
      const a = audits[id];
      if (!a) return null;
      return {
        score: a.score,
        value: a.numericValue ?? null,
        display: a.displayValue ?? null,
      };
    }

    // Top opportunities (audits in 'opportunity' group with savings > 0)
    const opportunities = Object.values(audits)
      .filter((a) => (a.score ?? 1) < 0.9 && (a.details?.overallSavingsMs ?? 0) > 100)
      .sort(
        (a, b) =>
          (b.details?.overallSavingsMs ?? 0) - (a.details?.overallSavingsMs ?? 0),
      )
      .slice(0, 8)
      .map((a) => ({
        id: a.id,
        title: a.title,
        description: a.description,
        score: a.score,
        savings_ms: a.details?.overallSavingsMs ?? null,
        display: a.displayValue ?? null,
      }));

    const summary = {
      url,
      strategy,
      scores: {
        performance: Math.round((categories.performance?.score ?? 0) * 100),
        seo: Math.round((categories.seo?.score ?? 0) * 100),
        accessibility: Math.round((categories.accessibility?.score ?? 0) * 100),
        best_practices: Math.round((categories["best-practices"]?.score ?? 0) * 100),
      },
      core_web_vitals: {
        lcp: metric("largest-contentful-paint"),
        cls: metric("cumulative-layout-shift"),
        inp: metric("interaction-to-next-paint") ?? metric("max-potential-fid"),
        tbt: metric("total-blocking-time"),
        fcp: metric("first-contentful-paint"),
        ttfb: metric("server-response-time"),
        speed_index: metric("speed-index"),
      },
      opportunities,
    };

    return json({ ok: true, ...summary });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[seo-pagespeed] error", msg);
    return json({ error: msg }, 500);
  }
});
