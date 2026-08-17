/**
 * canva-list-designs — returns the authenticated user's Canva designs.
 *
 * Canva doesn't expose a direct "starred" filter on the Designs API.
 * The closest proxies are:
 *   - ownership = "owned_by_me" (default)
 *   - sort_by = "modified_descending" | "title_ascending"
 *   - filter by query string
 *
 * Client call:
 *   GET /functions/v1/canva-list-designs?query=ad&continuation=xyz
 *   -> { designs: [{ id, title, thumbnail, urls }], continuation }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  canvaFetch,
  getUserFromAuthHeader,
  loadTokens,
} from "../_shared/canva-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "missing auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = await getUserFromAuthHeader(authHeader);
    if (!user) {
      return new Response(JSON.stringify({ error: "invalid user" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const tokens = await loadTokens(user.id);
    if (!tokens) {
      return new Response(JSON.stringify({ error: "not_connected" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const query = url.searchParams.get("query") || "";
    const continuation = url.searchParams.get("continuation") || "";
    const ownership = url.searchParams.get("ownership") || "owned_by_me";
    const sortBy = url.searchParams.get("sort_by") || "modified_descending";

    const canvaUrl = new URL("https://api.canva.com/rest/v1/designs");
    canvaUrl.searchParams.set("ownership", ownership);
    canvaUrl.searchParams.set("sort_by", sortBy);
    if (query) canvaUrl.searchParams.set("query", query);
    if (continuation) canvaUrl.searchParams.set("continuation", continuation);

    const res = await canvaFetch(tokens, canvaUrl.toString());
    if (!res.ok) {
      const detail = await res.text();
      return new Response(JSON.stringify({ error: "canva_api_error", detail, status: res.status }), {
        status: res.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await res.json();

    const designs = (data.items || []).map((d: any) => ({
      id: d.id,
      title: d.title || "Untitled",
      thumbnail: d.thumbnail?.url || null,
      edit_url: d.urls?.edit_url || null,
      view_url: d.urls?.view_url || null,
      updated_at: d.updated_at || null,
    }));

    return new Response(
      JSON.stringify({ designs, continuation: data.continuation || null }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
