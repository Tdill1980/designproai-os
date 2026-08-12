/**
 * DesignPanelProWorkspace — one screen listing ALL past DesignPanelPro orders in
 * columns: Source · Artboard/Proof · Panels · Elements · Open.
 *
 * Route: /designpanelpro-workspace
 *
 * Read-only. Orders come from color_visualizations (the DesignPanelPro/RecreatePro
 * jobs); built panel files come from production_flow_assets (keyed by job_id = the
 * order id — the same id Build Files / the Design Assets page use). White UI.
 */

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Boxes, Layers, Image as ImageIcon, ExternalLink, Loader2 } from "lucide-react";

const CHECKER =
  "[background-image:linear-gradient(45deg,#e5e7eb_25%,transparent_25%),linear-gradient(-45deg,#e5e7eb_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e5e7eb_75%),linear-gradient(-45deg,transparent_75%,#e5e7eb_75%)] [background-size:12px_12px] [background-position:0_0,0_6px,6px_-6px,-6px_0]";

interface Order {
  id: string;
  created_at: string;
  vehicle_year: string | number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  mode_type: string | null;
  render_urls: Record<string, string> | null;
  admin_notes: string | null;
}
interface Panel {
  job_id: string;
  side: string;
  background_url: string | null;
  branding_url: string | null;
}

function parseNotes(n: string | null): Record<string, any> {
  if (!n) return {};
  try { return JSON.parse(n) || {}; } catch { return {}; }
}
function sourceThumb(o: Order, notes: Record<string, any>): string | null {
  const ru = o.render_urls || {};
  return (ru as any).master_artboard || notes.flat_proof_url || (ru as any).side || (ru as any).hero ||
    Object.values(ru).find(Boolean) as string || null;
}

export default function DesignPanelProWorkspace() {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["dpp_workspace_orders"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const email = user?.email;
      // The DesignPanelPro / RecreatePro / DesignPro orders.
      let q = (supabase as any)
        .from("color_visualizations")
        .select("id, created_at, vehicle_year, vehicle_make, vehicle_model, mode_type, render_urls, admin_notes")
        .in("mode_type", ["designpanelpro", "recreatepro", "designpro"])
        .not("render_urls", "is", null)
        .order("created_at", { ascending: false })
        .limit(60);
      if (email) q = q.eq("customer_email", email);
      const { data: orders } = await q;
      const list = (orders || []) as Order[];

      // Built panel files for these orders.
      //
      // production_flow_assets is keyed by the DESIGNIQ GENERATION id, not by
      // the color_visualizations id these cards are listed under. The entice
      // pack writes job_id = design_id = designiq_generation_id (the vault fence
      // in verify_designpro_entice_pack asserts exactly that), so matching order
      // ids against job_id could never hit: every design with a completed pack
      // rendered as "not built" while its panels sat in the vault. Live on
      // 2026-08-10, pack 9c737af3 — six sides present, workspace showed zero.
      //
      // Resolve each order's canonical id the way RevisionStudio already does,
      // then look panels up under BOTH identities so legacy rows keyed by the
      // visualization id keep working alongside pack rows keyed by generation.
      const ids = list.map((o) => o.id);
      const orderIdByKey = new Map<string, string>();
      // Self-identity first, so a canonical id can never displace a real order.
      for (const o of list) orderIdByKey.set(o.id, o.id);
      const canonicalIds: string[] = [];
      for (const o of list) {
        const canonical = String(
          parseNotes(o.admin_notes).designiq_generation_id || "",
        ).trim();
        if (!canonical) continue;
        canonicalIds.push(canonical);
        // `list` is newest-first, so first writer wins: when several revisions
        // share one generation, its panels land on the most recent card.
        if (!orderIdByKey.has(canonical)) orderIdByKey.set(canonical, o.id);
      }

      const lookupIds = [...new Set([...ids, ...canonicalIds])];
      let panels: Panel[] = [];
      if (lookupIds.length) {
        const { data: pfa } = await (supabase as any)
          .from("production_flow_assets")
          .select("job_id, side, background_url, branding_url")
          .in("job_id", lookupIds);
        panels = (pfa || []) as Panel[];
      }
      const byJob: Record<string, Panel[]> = {};
      for (const p of panels) {
        // Group under the ORDER the card is drawn from, not the raw job_id.
        const orderId = orderIdByKey.get(p.job_id);
        if (!orderId) continue;
        (byJob[orderId] ||= []).push(p);
      }
      return { list, byJob };
    },
  });

  const orders = data?.list || [];
  const byJob = data?.byJob || {};
  const builtCount = useMemo(() => orders.filter((o) => (byJob[o.id]?.length || 0) > 0).length, [orders, byJob]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-5">
        {/* Header */}
        <div className="rounded-2xl bg-white border border-gray-200 shadow-md overflow-hidden">
          <div className="h-1.5 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />
          <div className="flex items-center gap-4 px-6 py-5">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#3b82f6] to-[#ec4899] flex items-center justify-center shadow-md shrink-0">
              <Boxes className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase">DesignPanelPro™ Admin</div>
              <h1 className="text-2xl font-extrabold text-gray-900 leading-tight">Orders Workspace</h1>
              <p className="mt-0.5 text-[11px] text-gray-500">
                {orders.length} orders · {builtCount} with built panel files
              </p>
            </div>
          </div>
        </div>

        {/* Column header */}
        <div className="hidden lg:grid grid-cols-[1.1fr_1.3fr_1.3fr_1.3fr_auto] gap-4 px-4 text-[11px] font-bold uppercase tracking-wide text-gray-500">
          <div>Order</div><div>Source</div><div>Panels (background)</div><div>Elements (overlay)</div><div>Open</div>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 px-4 py-10">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading orders…
          </div>
        ) : orders.length === 0 ? (
          <div className="rounded-2xl bg-white border border-gray-200 shadow-md p-6 text-center text-sm text-gray-600">
            No DesignPanelPro orders found yet.
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((o) => {
              const notes = parseNotes(o.admin_notes);
              const src = sourceThumb(o, notes);
              const panels = (byJob[o.id] || []).slice().sort((a, b) => a.side.localeCompare(b.side));
              const prompt = notes.original_prompt || notes.edit_instructions || "";
              const vehicle = [o.vehicle_year, o.vehicle_make, o.vehicle_model].filter(Boolean).join(" ") || "Vehicle";
              return (
                <div key={o.id} className="rounded-2xl bg-white border border-gray-200 shadow-sm hover:border-[#3b82f6] transition-colors p-4 grid grid-cols-1 lg:grid-cols-[1.1fr_1.3fr_1.3fr_1.3fr_auto] gap-4 items-start">
                  {/* Order */}
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{vehicle}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">{o.mode_type} · {new Date(o.created_at).toLocaleDateString()}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{o.id.slice(0, 8)}</p>
                    {panels.length > 0
                      ? <span className="inline-block mt-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">{panels.length} panels built</span>
                      : <span className="inline-block mt-2 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">not built</span>}
                  </div>

                  {/* Source */}
                  <div className="min-w-0">
                    {src ? (
                      <a href={src} target="_blank" rel="noreferrer" className="block rounded-lg border border-gray-200 overflow-hidden bg-gray-50">
                        <img src={src} alt="source" className="w-full h-24 object-contain" loading="lazy" />
                      </a>
                    ) : <div className="h-24 rounded-lg border border-dashed border-gray-200 flex items-center justify-center text-[11px] text-gray-400"><ImageIcon className="w-4 h-4 mr-1" />no source</div>}
                    {prompt && <p className="mt-1 text-[10px] text-gray-500 line-clamp-2">{prompt}</p>}
                  </div>

                  {/* Panels — backgrounds */}
                  <div className="min-w-0">
                    {panels.length === 0 ? (
                      <p className="text-[11px] text-gray-400">—</p>
                    ) : (
                      <div className="grid grid-cols-3 gap-1.5">
                        {panels.map((p) => p.background_url ? (
                          <a key={`bg-${p.side}`} href={p.background_url} target="_blank" rel="noreferrer" title={`${p.side} background`} className="block rounded border border-gray-200 overflow-hidden bg-gray-50">
                            <img src={p.background_url} alt={p.side} className="w-full h-12 object-cover" loading="lazy" />
                          </a>
                        ) : null)}
                      </div>
                    )}
                  </div>

                  {/* Elements — transparent overlays */}
                  <div className="min-w-0">
                    {panels.length === 0 ? (
                      <p className="text-[11px] text-gray-400">—</p>
                    ) : (
                      <div className="grid grid-cols-3 gap-1.5">
                        {panels.map((p) => p.branding_url ? (
                          <a key={`ov-${p.side}`} href={p.branding_url} target="_blank" rel="noreferrer" title={`${p.side} overlay`} className={`block rounded border border-gray-200 overflow-hidden ${CHECKER}`}>
                            <img src={p.branding_url} alt={p.side} className="w-full h-12 object-contain" loading="lazy" />
                          </a>
                        ) : null)}
                      </div>
                    )}
                  </div>

                  {/* Open */}
                  <div className="shrink-0">
                    <button
                      onClick={() => navigate(`/design-assets/${o.id}`)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white bg-gradient-to-r from-[#3b82f6] to-[#ec4899] shadow-sm hover:brightness-110"
                    >
                      <Layers className="w-3.5 h-3.5" /> Open
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
