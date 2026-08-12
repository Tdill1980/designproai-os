/**
 * MarketingCanvaTemplates — the design engine control for the Marketing Agent.
 *
 * The agent's "real branding" designs come from autofilling the operator's OWN
 * Canva Brand Template (their real logo/fonts/colors), not from AI image
 * generation. This panel lets the operator (1) connect/reconnect Canva with the
 * autofill scopes and (2) pick which Brand Template each brand uses. Once a
 * brand is mapped, every design the agent drafts is that template, filled.
 * Backed by marketing-agent actions canva_templates / canva_config / canva_map.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Palette, RefreshCw, CheckCircle2, Link2, Loader2, AlertCircle } from "lucide-react";
import {
  CANVA_BRANDBOARD_BRANDS,
  canonicalCanvaBrandBoardBrand,
  type CanvaBrandBoardBrand,
} from "@/lib/canvaBrandBoard";

type Brand = CanvaBrandBoardBrand;
const BRAND_LABELS: Record<Brand, string> = {
  designproai: "DesignProAI",
  weprintwraps: "WePrintWraps",
};
const BRANDS: readonly Brand[] = CANVA_BRANDBOARD_BRANDS;

type Template = { id: string; title: string; thumbnail: string | null };
type MapRow = { brand: string; template_id?: string; template_title?: string; reel_template_id?: string; reel_template_title?: string };

export default function MarketingCanvaTemplates() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [maps, setMaps] = useState<Record<string, MapRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingBrand, setSavingBrand] = useState<string | null>(null);
  const [missingScopes, setMissingScopes] = useState<string[]>([]);

  const call = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    const edgeAction = action === "canva_config" ? "config"
      : action === "canva_templates" ? "templates"
      : action === "canva_map" ? "map"
      : action;
    const { data, error } = await supabase.functions.invoke("canva-brandboard", {
      body: { action: edgeAction, ...extra },
    });
    if (error) throw error;
    if (data?.error && data.error !== "canva_not_connected") throw new Error(data.error);
    return data;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    // Connection truth comes from canva-status, not from whether a template
    // call happened to throw. The old flow inferred "connected" from the
    // marketing-agent response and treated ANY other error as a hard failure —
    // which left `connected` at null, rendered the mapping UI over an empty
    // list, and hid the Connect button behind an error the operator could do
    // nothing about. Status first, then templates, each failing on its own.
    let isConnected = false;
    try {
      const { data: status } = await supabase.functions.invoke("canva-status", { body: {} });
      isConnected = !!status?.connected;
      setConnected(isConnected);
      setMissingScopes(status?.missing_autofill_scopes || []);
    } catch {
      setConnected(false);
    }

    try {
      const cfg = await call("canva_config");
      const m: Record<string, MapRow> = {};
      (cfg?.maps || []).forEach((row: MapRow) => {
        const brand = canonicalCanvaBrandBoardBrand(row.brand);
        if (brand) m[brand] = { ...row, brand };
      });
      setMaps(m);
    } catch {
      // A missing mapping table must not hide the templates or the button.
    }

    if (isConnected) {
      try {
        const tpl = await call("canva_templates");
        if (tpl?.error === "canva_not_connected") {
          setConnected(false);
          setTemplates([]);
        } else {
          setTemplates(tpl?.templates || []);
        }
      } catch (e: any) {
        // The single most likely failure here is a 403 from Canva because the
        // token lacks brandtemplate:meta:read. Say so, instead of a bare
        // "canva 403", and leave Reconnect reachable.
        const msg = e?.message || "Failed to load Canva templates.";
        setError(
          /403|permission|scope/i.test(msg)
            ? `Canva refused the brand-template list (${msg}). The connected token is missing the autofill scopes — reconnect below.`
            : msg,
        );
        setTemplates([]);
      }
    }

    setLoading(false);
  }, [call]);

  useEffect(() => { load(); }, [load]);

  // `minimal` drops the autofill scopes. Offered only as a fallback: if Canva
  // rejects the full set with invalid_scope, a connection that can still export
  // designs beats no connection at all — but it cannot drive brand-template
  // autofill, so it is never the default and the UI says as much.
  const reconnect = async (minimal = false) => {
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("canva-oauth-init", {
        body: { redirect_to: "/admin/marketing-agent", minimal },
      });
      if (error) throw error;
      if (!data?.authorize_url) throw new Error(data?.error || "no authorize URL returned");
      window.location.href = data.authorize_url;
    } catch (e: any) {
      setError(e?.message || "Could not start Canva connect.");
    }
  };

  const assign = async (brand: Brand, templateId: string, kind: "image" | "reel" = "image") => {
    if (!templateId) return;
    setSavingBrand(brand + kind);
    try {
      const tpl = templates.find((t) => t.id === templateId);
      const res = await call("canva_map", { brand, template_id: templateId, template_title: tpl?.title, kind });
      const mappedBrand = canonicalCanvaBrandBoardBrand(res?.brand);
      if (
        res?.ok === true &&
        mappedBrand === brand &&
        res?.kind === kind &&
        String(res?.template_id || "") === templateId
      ) {
        setMaps((m) => ({
          ...m,
          [brand]: {
            ...(m[brand] || { brand }),
            ...(kind === "reel"
              ? { reel_template_id: templateId, reel_template_title: tpl?.title }
              : { template_id: templateId, template_title: tpl?.title }),
          },
        }));
      } else {
        setError(res?.error || "Canva returned a mapping for a different brand, kind, or template.");
      }
    } catch (e: any) {
      setError(e?.message || "Could not save template.");
    } finally {
      setSavingBrand(null);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-semibold text-slate-900">Design engine — Canva Brand Templates</span>
        </div>
        <button
          onClick={load}
          className="text-slate-400 hover:text-slate-700"
          title="Refresh"
          disabled={loading}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="p-4 space-y-3">
        <p className="text-[13px] text-slate-500">
          The agent fills <span className="font-medium text-slate-700">your own Canva Brand Template</span>{" "}
          (real logo, fonts, colors) with each piece's copy — no AI-invented branding. Map a template per brand.
        </p>

        {error && (
          <div className="flex items-start gap-2 text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-slate-500 text-sm py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading your Canva templates…
          </div>
        ) : !connected ? (
          <div className="text-center py-4">
            <p className="text-sm text-slate-600 mb-3">
              Canva isn't connected yet. Connecting asks for autofill permission so the
              agent can fill your own Brand Templates.
            </p>
            <button
              onClick={() => reconnect(false)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
            >
              <Link2 className="w-4 h-4" /> Connect Canva
            </button>
            <div className="mt-3">
              <button
                onClick={() => reconnect(true)}
                className="text-[11px] text-slate-400 hover:text-slate-700 underline"
              >
                Canva rejected the permissions? Connect without autofill
              </button>
            </div>
          </div>
        ) : (
          <>
            {missingScopes.length > 0 && (
              <div className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <span className="font-medium">Connected, but autofill is not available.</span>{" "}
                This Canva token is missing{" "}
                <code className="font-mono">{missingScopes.join(", ")}</code>. Templates
                can't be listed or filled until you reconnect and approve those permissions.
                <button
                  onClick={() => reconnect(false)}
                  className="ml-1 underline font-medium hover:text-amber-900"
                >
                  Reconnect now
                </button>
              </div>
            )}
            {templates.length === 0 && (
              <div className="text-[12px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                No autofill-capable Brand Templates found on your Canva account. In Canva, open a Brand
                Template and add data fields (autofill), then refresh here.
              </div>
            )}
            <div className="space-y-2">
              {BRANDS.map((brand) => {
                const current = maps[brand];
                return (
                  <div key={brand} className="flex items-start gap-3 py-1.5">
                    <div className="w-28 shrink-0 pt-1.5">
                      <div className="text-sm font-medium text-slate-800">{BRAND_LABELS[brand]}</div>
                      <div className="text-[11px] flex flex-col">
                        <span className={current?.template_id ? "text-emerald-600" : "text-slate-400"}>
                          {current?.template_id ? "◾ image ✓" : "◽ image"}
                        </span>
                        <span className={current?.reel_template_id ? "text-emerald-600" : "text-slate-400"}>
                          {current?.reel_template_id ? "🎬 reel ✓" : "🎬 reel"}
                        </span>
                      </div>
                    </div>
                    <div className="flex-1 space-y-1.5">
                      <select
                        value={current?.template_id || ""}
                        onChange={(e) => assign(brand, e.target.value, "image")}
                        disabled={savingBrand === brand + "image" || templates.length === 0}
                        className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-50"
                      >
                        <option value="">— image template (post/ad) —</option>
                        {templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                      </select>
                      <select
                        value={current?.reel_template_id || ""}
                        onChange={(e) => assign(brand, e.target.value, "reel")}
                        disabled={savingBrand === brand + "reel" || templates.length === 0}
                        className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-200 disabled:opacity-50"
                      >
                        <option value="">— 🎬 reel/video template (exports MP4) —</option>
                        {templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                      </select>
                    </div>
                    {(savingBrand === brand + "image" || savingBrand === brand + "reel") && <Loader2 className="w-4 h-4 animate-spin text-slate-400 mt-1.5" />}
                  </div>
                );
              })}
            </div>
            <button onClick={() => reconnect(false)} className="text-[12px] text-slate-400 hover:text-slate-700 underline">
              Reconnect Canva
            </button>
          </>
        )}
      </div>
    </div>
  );
}
