/**
 * RecentRendersRail
 *
 * Shows the shop's most recent renders from `color_visualizations` (the
 * unified renders table written to by ColorPro, DesignPro, FadeWraps,
 * and other tools) in the ApprovePro left rail. Tapping a row opens
 * SendForApprovalDialog pre-filled with the render's vehicle, design
 * name, finish, and all view URLs — so designers can send an approval
 * email without re-opening the originating tool.
 *
 * Filtered by shop_id = current user. Last 30 renders, newest first,
 * any with at least one URL in render_urls.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SendForApprovalDialog } from "@/components/proof/SendForApprovalDialog";
import { Sparkles, Loader2, ArrowRight, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface RecentRender {
  id: string;
  render_urls: Record<string, string> | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_type: string | null;
  design_file_name: string | null;
  color_name: string | null;
  finish_type: string | null;
  tool_source: string | null;
  mode_type: string | null;
  created_at: string | null;
}

const TOOL_LABEL: Record<string, string> = {
  colorpro: "ColorPro",
  designpro: "DesignPro",
  designpanelpro: "DesignPro",
  fadewraps: "FadeWraps",
  patternpro: "PatternPro",
  graphicspro: "GraphicsPro",
};

function firstUrl(urls: Record<string, string> | null): string | null {
  if (!urls) return null;
  for (const v of Object.values(urls)) {
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function titleOf(r: RecentRender): string {
  return r.design_file_name || r.color_name || "Untitled render";
}

function vehicleOf(r: RecentRender): string {
  return [r.vehicle_year, r.vehicle_make, r.vehicle_model].filter(Boolean).join(" ");
}

function toolLabel(r: RecentRender): string {
  const key = (r.tool_source || r.mode_type || "").toLowerCase();
  return TOOL_LABEL[key] || "Render";
}

function relativeDate(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export const RecentRendersRail = () => {
  const [renders, setRenders] = useState<RecentRender[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<RecentRender | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setRenders([]);
          setLoading(false);
          return;
        }
        // Match renders this user created. Historically rows were tagged by
        // shop_id, but a large share (especially tool renders) land with
        // shop_id NULL and are only keyed by customer_email — those used to
        // silently never appear here, which is why a designer's fresh renders
        // looked "lost" and had no path onto a proof. Match on EITHER
        // shop_id = user.id OR customer_email = user.email so nothing the
        // user made goes missing.
        const orFilter = user.email
          ? `shop_id.eq.${user.id},customer_email.eq.${user.email}`
          : `shop_id.eq.${user.id}`;
        const { data, error } = await supabase
          .from("color_visualizations")
          .select(
            "id, render_urls, vehicle_year, vehicle_make, vehicle_model, vehicle_type, design_file_name, color_name, finish_type, tool_source, mode_type, created_at",
          )
          .or(orFilter)
          .not("render_urls", "is", null)
          .order("created_at", { ascending: false })
          .limit(30);
        if (error) {
          setRenders([]);
        } else {
          const rows = (data || []) as RecentRender[];
          setRenders(rows.filter((r) => firstUrl(r.render_urls)));
        }
      } catch {
        setRenders([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <Card className="p-3 flex items-center gap-2 text-xs text-muted-foreground border-dashed">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading recent renders…
      </Card>
    );
  }
  if (!renders || renders.length === 0) return null;

  return (
    <>
      <Card className="p-3 space-y-2 border-cyan-200 bg-gradient-to-br from-cyan-50/60 to-blue-50/60">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-cyan-700" />
          <h3 className="text-xs font-bold text-cyan-900 uppercase tracking-wider">
            Recent Renders
          </h3>
          <Badge
            variant="outline"
            className="text-[9px] h-4 px-1 bg-white/70 border-cyan-200 text-cyan-700"
          >
            {renders.length}
          </Badge>
        </div>
        <p className="text-[11px] text-cyan-900/70">
          Tap any render from ColorPro, DesignPro, or FadeWraps to send it for
          client approval — no re-typing.
        </p>

        <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
          {renders.map((r) => {
            const thumb = firstUrl(r.render_urls);
            const title = titleOf(r);
            const veh = vehicleOf(r);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelected(r)}
                className={cn(
                  "w-full text-left rounded-md border border-cyan-200/60 bg-white/70",
                  "hover:bg-white hover:border-cyan-400 transition-colors p-2",
                )}
              >
                <div className="flex gap-2 items-center">
                  <div className="w-10 h-10 rounded bg-zinc-100 overflow-hidden shrink-0 flex items-center justify-center">
                    {thumb ? (
                      <img src={thumb} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon className="w-4 h-4 text-zinc-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[12px] font-semibold text-zinc-900 truncate">
                        {title}
                      </p>
                      <Badge
                        variant="outline"
                        className="text-[8px] h-3.5 px-1 shrink-0 bg-white border-cyan-200 text-cyan-700"
                      >
                        {toolLabel(r)}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-zinc-600 truncate">
                      {veh || "Vehicle —"}
                    </p>
                    <p className="text-[10px] text-zinc-500/80">
                      {relativeDate(r.created_at)}
                    </p>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      {selected && (
        <SendForApprovalDialog
          open={!!selected}
          onOpenChange={(v) => !v && setSelected(null)}
          context={{
            visualizationId: selected.id,
            renderUrls: (selected.render_urls || {}) as Record<string, string>,
            vehicleYear: selected.vehicle_year ? String(selected.vehicle_year) : undefined,
            vehicleMake: selected.vehicle_make || undefined,
            vehicleModel: selected.vehicle_model || undefined,
            vehicleType: selected.vehicle_type || undefined,
            designName: titleOf(selected),
            finishType: selected.finish_type || undefined,
            defaultMode: "revision_loop",
          }}
        />
      )}
    </>
  );
};
