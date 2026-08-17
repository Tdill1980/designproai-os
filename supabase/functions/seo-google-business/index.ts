/**
 * seo-google-business — Google Business Profile (GBP) operations.
 *
 * NOTE: GBP API access requires Google approval on the project. Once approved,
 * the project can call Account Management v1, Business Information v1, and
 * My Business v1 (Posts + Insights). Until approved, requests will return
 * 403/404; the UI surfaces these errors but the rest of the toolkit is
 * unaffected.
 *
 * Actions:
 *   list_accounts        → Account Management API
 *   list_locations       → Business Information API (per accountName)
 *   set_location         → save chosen locationName in connection metadata
 *   list_reviews         → fetch reviews for the saved location
 *   reply_to_review      → reply text on a review
 *   create_post          → publish a "What's New" / Offer / Event GBP Post
 *   suggest_review_reply → use Claude to draft a reply (no posting)
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

async function gbpFetch(token: string, url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(url, { ...init, headers });
  return res;
}

async function suggestReply(reviewText: string, reviewer: string, rating: number, brand: string): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const sentiment = rating >= 4 ? "positive" : rating === 3 ? "neutral" : "negative";
  const sys = `You write GBP review replies for ${brand}. Replies are short (40-80 words), warm, specific (reference what the reviewer said), use the reviewer's first name once, sign off with the brand name. For negative reviews: acknowledge the specific pain, apologize without admitting legal liability, offer a clear next step (phone, email, or "DM us"). Never sound like a template. Never use "we strive to" or "your satisfaction is our priority". No emojis.`;
  const user = `Sentiment: ${sentiment} (${rating}/5)\nReviewer: ${reviewer}\nReview: "${reviewText}"\n\nWrite the reply only — no preamble.`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      system: sys,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Claude ${res.status}`);
  }
  const data = await res.json();
  return data?.content?.find((c: { type: string; text?: string }) => c.type === "text")?.text ?? "";
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
      "google_business_profile",
    );

    if (action === "list_accounts") {
      const res = await gbpFetch(access_token, "https://mybusinessaccountmanagement.googleapis.com/v1/accounts");
      if (!res.ok) {
        const txt = await res.text();
        return json({ error: `GBP accounts ${res.status}: ${txt.slice(0, 400)}` }, 502);
      }
      const data = await res.json();
      return json({ ok: true, accounts: data.accounts ?? [] });
    }

    if (action === "list_locations") {
      const accountName = body?.account_name as string;
      if (!accountName) return json({ error: "account_name required" }, 400);
      const fields = "name,title,storefrontAddress,websiteUri,phoneNumbers,categories,metadata";
      const res = await gbpFetch(
        access_token,
        `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=${fields}&pageSize=100`,
      );
      if (!res.ok) {
        const txt = await res.text();
        return json({ error: `GBP locations ${res.status}: ${txt.slice(0, 400)}` }, 502);
      }
      const data = await res.json();
      return json({ ok: true, locations: data.locations ?? [] });
    }

    if (action === "set_location") {
      await assertShopAdmin(ctx, shop_id);
      const accountName = body?.account_name as string;
      const locationName = body?.location_name as string;
      const displayName = body?.display_name as string | undefined;
      if (!accountName || !locationName) {
        return json({ error: "account_name + location_name required" }, 400);
      }
      const newMeta = {
        ...metadata,
        gbp_account: accountName,
        gbp_location: locationName,
        gbp_display_name: displayName,
      };
      const { error } = await ctx.service
        .from("tenant_site_connections")
        .update({ metadata: newMeta, display_name: displayName ?? null })
        .eq("shop_id", shop_id)
        .eq("platform", "google_business_profile");
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    const locationName = (body?.location_name as string) ?? (metadata?.gbp_location as string);
    const accountName = (body?.account_name as string) ?? (metadata?.gbp_account as string);

    if (action === "list_reviews") {
      if (!accountName || !locationName) {
        return json({ error: "No GBP location selected" }, 400);
      }
      const res = await gbpFetch(
        access_token,
        `https://mybusiness.googleapis.com/v4/${accountName}/${locationName}/reviews?pageSize=50`,
      );
      if (!res.ok) {
        const txt = await res.text();
        return json({ error: `GBP reviews ${res.status}: ${txt.slice(0, 400)}` }, 502);
      }
      const data = await res.json();
      return json({ ok: true, reviews: data.reviews ?? [], total: data.totalReviewCount ?? 0 });
    }

    if (action === "reply_to_review") {
      if (!accountName || !locationName) {
        return json({ error: "No GBP location selected" }, 400);
      }
      const reviewName = body?.review_name as string;
      const comment = body?.comment as string;
      if (!reviewName || !comment) {
        return json({ error: "review_name + comment required" }, 400);
      }
      const res = await gbpFetch(
        access_token,
        `https://mybusiness.googleapis.com/v4/${reviewName}/reply`,
        { method: "PUT", body: JSON.stringify({ comment }) },
      );
      if (!res.ok) {
        const txt = await res.text();
        return json({ error: `Reply ${res.status}: ${txt.slice(0, 400)}` }, 502);
      }
      return json({ ok: true });
    }

    if (action === "create_post") {
      if (!accountName || !locationName) {
        return json({ error: "No GBP location selected" }, 400);
      }
      const summary = body?.summary as string;
      const topicType = (body?.topic_type as string) ?? "STANDARD";
      const callToAction = body?.call_to_action as
        | { actionType: string; url?: string }
        | undefined;
      const mediaUrl = body?.media_url as string | undefined;
      if (!summary) return json({ error: "summary required" }, 400);

      const payload: Record<string, unknown> = {
        languageCode: "en-US",
        summary,
        topicType,
      };
      if (callToAction) payload.callToAction = callToAction;
      if (mediaUrl) payload.media = [{ mediaFormat: "PHOTO", sourceUrl: mediaUrl }];

      const res = await gbpFetch(
        access_token,
        `https://mybusiness.googleapis.com/v4/${accountName}/${locationName}/localPosts`,
        { method: "POST", body: JSON.stringify(payload) },
      );
      if (!res.ok) {
        const txt = await res.text();
        return json({ error: `GBP post ${res.status}: ${txt.slice(0, 400)}` }, 502);
      }
      const data = await res.json();
      return json({ ok: true, post: data });
    }

    if (action === "suggest_review_reply") {
      const reviewText = body?.review_text as string;
      const reviewer = (body?.reviewer as string) ?? "the reviewer";
      const rating = (body?.rating as number) ?? 5;
      if (!reviewText) return json({ error: "review_text required" }, 400);
      const { data: shop } = await ctx.db.from("shops").select("name").eq("id", shop_id).maybeSingle();
      const reply = await suggestReply(reviewText, reviewer, rating, shop?.name ?? "the shop");
      return json({ ok: true, reply });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[seo-google-business] error", msg);
    return json({ error: msg }, 500);
  }
});
