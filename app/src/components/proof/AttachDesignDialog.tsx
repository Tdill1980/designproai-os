/**
 * AttachDesignDialog — link a design you made (DesignPro / Freestyle /
 * Re-create Pro / ColorPro) to THIS WePrintWraps order's proof.
 *
 * The gap this closes: WPW order proofs arrive as uploaded artwork with no
 * link to an RP-generated design (source_visualization_id = null), so the
 * customer's "Revise with AI" on the approval page has nothing to revise
 * from. Attaching a render here:
 *   1. saves it as the proof's active version (proof-save-version), and
 *   2. stamps proof_approvals.source_visualization_id = the render id,
 * so the design now backs the order — AI revise, version history, and
 * order-number search all light up.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Loader2, Search, ImageIcon, Link2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface RenderRow {
  id: string;
  render_urls: Record<string, string> | null;
  design_file_name: string | null;
  color_name: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  mode_type: string | null;
  created_at: string;
}

const MODE_LABEL: Record<string, string> = {
  designpanelpro: "DesignPro",
  designpanelpropremium: "DesignPro",
  recreatepro: "Re-create Pro",
  colorpro: "ColorPro",
  fadewraps: "FadeWraps",
};

function firstUrl(u: Record<string, string> | null): string | null {
  if (!u) return null;
  return u.hero || u.side || u.roof || u.front || Object.values(u)[0] || null;
}

interface AttachDesignDialogProps {
  proofId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAttached: () => void;
}

export function AttachDesignDialog({ proofId, open, onOpenChange, onAttached }: AttachDesignDialogProps) {
  const [loading, setLoading] = useState(false);
  const [renders, setRenders] = useState<RenderRow[]>([]);
  const [search, setSearch] = useState("");
  const [attachingId, setAttachingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const email = session?.user?.email;
        let q = supabase
          .from("color_visualizations")
          .select("id, render_urls, design_file_name, color_name, vehicle_year, vehicle_make, vehicle_model, mode_type, created_at")
          .in("generation_status", ["completed", "complete"])
          .not("render_urls", "is", null)
          .order("created_at", { ascending: false })
          .limit(60);
        if (email) q = q.eq("customer_email", email);
        if (search.trim()) {
          const s = search.trim();
          q = q.or(`design_file_name.ilike.%${s}%,color_name.ilike.%${s}%,vehicle_make.ilike.%${s}%,vehicle_model.ilike.%${s}%`);
        }
        const { data } = await q;
        if (cancelled) return;
        setRenders(((data || []) as RenderRow[]).filter((r) => firstUrl(r.render_urls)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, search]);

  const attach = async (r: RenderRow) => {
    setAttachingId(r.id);
    try {
      // 1. Save the design's renders as the proof's active version.
      // proof-save-version requires an Idempotency-Key header (returns 400
      // without it) — match the pattern used by PullFromQCDialog /
      // ProofUploadVersion so the attach doesn't get rejected at the door.
      const { data, error } = await supabase.functions.invoke("proof-save-version", {
        body: { proof_id: proofId, render_urls: r.render_urls, shop_message: "Design attached from RP tools" },
        headers: { "Idempotency-Key": `attach-${proofId}-${r.id}-${Date.now()}` },
      });
      if (error || !(data as any)?.success) {
        let msg = (data as any)?.error || error?.message || "Attach failed";
        // FunctionsHttpError surfaces only "non-2xx status code" and hides the
        // JSON body — dig out the real reason from the response for the toast.
        const ctx = (error as any)?.context;
        if (ctx && typeof ctx.json === "function") {
          try { const b = await ctx.json(); if (b?.error) msg = b.error; } catch { /* keep generic */ }
        }
        throw new Error(msg);
      }
      // 2. Link the design to the order so AI revise / search / history work.
      await supabase
        .from("proof_approvals" as any)
        .update({ source_visualization_id: r.id })
        .eq("id", proofId);
      toast({ title: "Design attached", description: "It's now the proof's version — ready to send or AI-revise." });
      onAttached();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Couldn't attach", description: e.message, variant: "destructive" });
    } finally {
      setAttachingId(null);
    }
  };

  const vehicleOf = (r: RenderRow) =>
    [r.vehicle_year, r.vehicle_make, r.vehicle_model].filter((v) => v && v !== "Unknown").join(" ");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-white">
        <DialogHeader>
          <DialogTitle className="text-gray-900">Attach a design to this order</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-gray-600 -mt-1">
          Pick a design you made in DesignPro, Freestyle, Re‑create Pro or ColorPro. It becomes this
          proof's version and links to the order so the customer can Revise with AI.
        </p>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your designs (name, vehicle)…"
            className="pl-8 h-9 text-sm border-gray-200 bg-white text-gray-900"
          />
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-500" /></div>
        ) : renders.length === 0 ? (
          <p className="text-sm text-gray-600 text-center py-10">No designs found. Make one in DesignPro / Freestyle / Re‑create Pro first.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[55vh] overflow-y-auto pr-1">
            {renders.map((r) => {
              const thumb = firstUrl(r.render_urls);
              const busy = attachingId === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  disabled={!!attachingId}
                  onClick={() => attach(r)}
                  className="text-left rounded-lg border border-gray-200 overflow-hidden hover:border-blue-400 hover:ring-2 hover:ring-blue-200 transition disabled:opacity-50"
                >
                  <div className="aspect-video bg-gray-100 flex items-center justify-center">
                    {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" /> : <ImageIcon className="w-6 h-6 text-gray-300" />}
                  </div>
                  <div className="p-1.5">
                    <div className="text-[11px] font-semibold text-gray-900 truncate">{r.design_file_name || r.color_name || "Design"}</div>
                    <div className="text-[10px] text-gray-500 truncate">
                      {MODE_LABEL[(r.mode_type || "").toLowerCase()] || r.mode_type || "Design"}{vehicleOf(r) ? ` · ${vehicleOf(r)}` : ""}
                    </div>
                    <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600">
                      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                      {busy ? "Attaching…" : "Attach"}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
