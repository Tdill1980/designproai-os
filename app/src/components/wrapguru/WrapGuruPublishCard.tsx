import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Globe, Loader2, ExternalLink, ShieldCheck, AlertTriangle, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * WrapGuruPublishCard — publish the WrapGuru chat page to weprintwraps.com.
 *
 * Uses the SAFE publisher (`seo-aeo-publish` action:"publish_pillar"), the same
 * tool the Wrap TV World page went out through: it only creates/updates ONE
 * standalone WordPress page addressed by slug and never touches the live
 * Elementor layout, the homepage, or any other page.
 *
 * The page body is `public/embeds/wpw-wrapguru.html` — a self-contained,
 * theme-scoped (#wgru) block that talks straight to the wpw-sales-chat edge
 * function, so chats logged from WPW still land in Admin → WrapGuru Chats.
 *
 * Defaults to a WP DRAFT (the wrap-tv-world convention) so it can be previewed
 * on WPW before going live.
 */

const GRADIENT = "linear-gradient(90deg,#3b82f6,#ec4899)";
const EMBED_PATH = "/embeds/wpw-wrapguru.html";
const PAGE_TITLE = "WrapGuru";
const PAGE_SLUG = "wrapguru";

type Result = { url: string; status: string; id: number } | null;

export default function WrapGuruPublishCard() {
  const [busy, setBusy] = useState<"draft" | "publish" | null>(null);
  const [result, setResult] = useState<Result>(null);
  const [error, setError] = useState<string | null>(null);

  // Resolve the shop whose active WordPress connection points at WPW.
  const { data: conn, isLoading } = useQuery({
    queryKey: ["wrapguru-wp-connection"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenant_site_connections")
        .select("shop_id, site_url, is_active, shops(name)")
        .eq("platform", "wordpress")
        .eq("is_active", true)
        .ilike("site_url", "%weprintwraps%")
        .maybeSingle();
      if (error) throw error;
      return data as { shop_id: string; site_url: string; shops?: { name?: string } } | null;
    },
  });

  async function publish(status: "draft" | "publish") {
    if (!conn?.shop_id) return;
    setBusy(status);
    setError(null);
    setResult(null);
    try {
      // The page body is the embed file this app already serves.
      const res = await fetch(EMBED_PATH, { cache: "no-store" });
      if (!res.ok) throw new Error(`Could not load ${EMBED_PATH} (${res.status})`);
      const content = await res.text();
      if (!content.includes('id="wgru"')) {
        throw new Error("Embed file loaded but looks wrong — aborting rather than publishing bad markup.");
      }

      const { data, error: fnErr } = await supabase.functions.invoke("seo-aeo-publish", {
        body: {
          action: "publish_pillar",
          shop_id: conn.shop_id,
          title: PAGE_TITLE,
          slug: PAGE_SLUG,
          content,
          status,
        },
      });
      if (fnErr) throw fnErr;
      if (data?.error) throw new Error(data.error);
      const wpStatus = data?.wp_page?.status || status;
      setResult({
        url: data?.published_url || `${conn.site_url}/${PAGE_SLUG}`,
        status: wpStatus,
        id: data?.wp_page?.id,
      });
      // The `status` param needs the deployed seo-aeo-publish to honor it. An
      // older deploy hardcoded status:"publish" — if we asked for a draft and
      // WP reports it live, say so rather than letting it look like a draft.
      if (status === "draft" && wpStatus !== "draft") {
        setError(
          "Heads up: this went out LIVE, not as a draft — the seo-aeo-publish function still needs deploying " +
            "for draft mode to work. The page is public now; unpublish it in WP admin if that wasn't intended.",
        );
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 mb-5">
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-white" style={{ background: GRADIENT }}>
          <Globe className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm">Publish WrapGuru to weprintwraps.com</div>
          <p className="text-xs text-gray-500 mt-0.5">
            Creates one standalone page at <span className="font-mono text-gray-700">/{PAGE_SLUG}</span> using the safe
            publisher — never edits your Elementor layout, homepage, or any other page.
          </p>

          {isLoading ? (
            <div className="mt-3 text-xs text-gray-500 flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking the WordPress connection…
            </div>
          ) : !conn ? (
            <div className="mt-3 flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
              <span>
                No active WordPress connection for weprintwraps.com. Connect it in{" "}
                <a href="/admin/seo/connections" className="underline font-semibold">Admin → SEO → Connections</a> first.
              </span>
            </div>
          ) : (
            <>
              <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-emerald-700">
                <ShieldCheck className="w-3.5 h-3.5" />
                Connected: {conn.shops?.name || "We Print Wraps"} · {conn.site_url}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => publish("draft")}
                  disabled={!!busy}
                  className="flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: GRADIENT }}
                >
                  {busy === "draft" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  Publish as draft
                </button>
                <button
                  onClick={() => publish("publish")}
                  disabled={!!busy}
                  className="flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-300 hover:border-gray-400 disabled:opacity-50"
                >
                  {busy === "publish" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Publish live
                </button>
                <span className="text-[11px] text-gray-400">Draft lets you preview on WPW before it goes live.</span>
              </div>
            </>
          )}

          {result && (
            <div className="mt-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-2">
              Page {result.status === "draft" ? "saved as a draft" : "published live"} (WP id {result.id}) —{" "}
              <a href={result.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold underline">
                open on weprintwraps.com <ExternalLink className="w-3 h-3" />
              </a>
              {result.status === "draft" && (
                <div className="mt-1 text-emerald-700">
                  Drafts aren't public yet — review it in WP admin, then hit Publish there (or use “Publish live” above).
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2 break-words">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
