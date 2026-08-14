/**
 * /admin/creatormarket-manager — Curate the public CreatorMarket.
 *
 * Lists every row in marketplace_listings with a thumbnail, vehicle,
 * title, status, and current ordering position. Admin can:
 *   - Toggle is_hidden       → hide a listing from the public page
 *   - Click Move Up / Down   → adjust display_order so it sorts higher
 *                              or lower on /creatormarket
 *   - Click Pin to top       → assigns display_order = 0 (sorts first)
 *
 * All writes are direct supabase mutations against marketplace_listings;
 * RLS protects against non-admin callers.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
  Pin,
  Loader2,
  AlertCircle,
  Truck,
  Plus,
  Save,
  X,
  Search,
  Images,
} from "lucide-react";

// Trade taxonomy — pulled from cm-trade-options so the admin picker
// stays in sync with the public CreatorMarket chip filter and the
// CHECK constraint on marketplace_listings.trade_category.
import { CM_TRADES } from "@/lib/cm-trade-options";
const ADMIN_TRADE_OPTIONS: { slug: string; label: string }[] = CM_TRADES.map((t) => ({
  slug: t.slug,
  label: t.label,
}));
import { inferTradeCategory, buildSeoDescription } from "@/lib/cm-seo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Listing {
  id: string;
  title: string | null;
  thumbnail_url: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  price: number | null;
  status: string | null;
  is_hidden: boolean;
  display_order: number | null;
  listed_at: string | null;
  view_count: number | null;
  favorite_count: number | null;
  trade_category: string | null;
  offers_printed_wrap: boolean | null;
  featured_creator_name: string | null;
}

// Canonical 7 vehicle views — keep aligned with VIEW_LABELS in
// CreatorMarket.tsx and ListingDetailViewer.tsx so the public card's
// 3D gallery picks up everything the admin uploads.
const VIEW_FIELDS: { key: string; label: string }[] = [
  { key: "side", label: "Driver Side" },
  { key: "passenger-side", label: "Passenger Side" },
  { key: "front", label: "Front 3/4" },
  { key: "rear", label: "Rear 3/4" },
  { key: "hood_detail", label: "Hood Detail" },
  { key: "roof", label: "Roof" },
  { key: "close-up", label: "Close-Up" },
];

interface NewCardForm {
  title: string;
  industry_title: string;
  vehicle_year: string;
  vehicle_make: string;
  vehicle_model: string;
  featured_creator_name: string;
  trade_category: string;
  design_style: "custom" | "branded" | "fleet";
  price: string;
  thumbnail_url: string;
  panel_2d_url: string;
  install_video_url: string;
  views: Record<string, string>;
  offers_printed_wrap: boolean;
}

const EMPTY_FORM: NewCardForm = {
  title: "",
  industry_title: "",
  vehicle_year: "",
  vehicle_make: "",
  vehicle_model: "",
  featured_creator_name: "",
  trade_category: "",
  design_style: "custom",
  price: "350",
  thumbnail_url: "",
  panel_2d_url: "",
  install_video_url: "",
  views: VIEW_FIELDS.reduce((acc, v) => ({ ...acc, [v.key]: "" }), {} as Record<string, string>),
  offers_printed_wrap: false,
};

export default function AdminCreatorMarketManager() {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<NewCardForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");

  // Design library — every pre-rendered design the admin can pick to auto-fill
  // a card (thumbnail + all view URLs) instead of pasting URLs by hand. This is
  // the "assign a pre-designed job to a business" flow: pick a design, type the
  // business name (title), publish. Sourced from color_visualizations.
  const { data: designLibrary, isLoading: libraryLoading } = useQuery({
    queryKey: ["admin-cm-design-library", librarySearch],
    enabled: showLibrary,
    queryFn: async () => {
      let q = (supabase as any)
        .from("color_visualizations")
        .select("id, render_urls, vehicle_year, vehicle_make, vehicle_model, design_file_name, color_name, created_at")
        .not("render_urls", "is", null)
        .order("created_at", { ascending: false })
        .limit(60);
      const s = librarySearch.trim();
      if (s) q = q.or(`vehicle_make.ilike.%${s}%,vehicle_model.ilike.%${s}%,design_file_name.ilike.%${s}%`);
      const { data, error } = await q;
      if (error) { console.warn("design library query:", error); return []; }
      return (data || []) as any[];
    },
  });

  const libThumb = (ru: any): string | null => {
    if (!ru || typeof ru !== "object") return null;
    for (const k of ["hero", "side", "driver-side", "front", "close-up"]) {
      if (typeof ru[k] === "string" && ru[k].startsWith("http")) return ru[k];
    }
    const first = Object.values(ru).find((v) => typeof v === "string" && (v as string).startsWith("http"));
    return (first as string) || null;
  };

  // Load a picked design into the create form: thumbnail + view URLs + vehicle.
  const pickDesign = (item: any) => {
    const ru = item.render_urls || {};
    const views: Record<string, string> = { ...EMPTY_FORM.views };
    for (const v of VIEW_FIELDS) if (typeof ru[v.key] === "string" && ru[v.key]) views[v.key] = ru[v.key];
    if (!views.side && typeof ru.hero === "string" && ru.hero) views.side = ru.hero;
    setForm((f) => ({
      ...f,
      thumbnail_url: libThumb(ru) || "",
      views,
      vehicle_year: item.vehicle_year ? String(item.vehicle_year) : f.vehicle_year,
      vehicle_make: item.vehicle_make || f.vehicle_make,
      vehicle_model: item.vehicle_model || f.vehicle_model,
    }));
    setShowLibrary(false);
    setShowCreate(true);
    toast.success("Design loaded — set the business name (title) and publish");
  };

  // ── Publish Backlog: list every completed, unlisted design at once ──
  // Sources completed production packs (the print-ready set), skips ones already
  // listed, tags a trade + description, and inserts them as 'pending_review' so
  // they can be approved at /admin/creator-market before going public. Runs in
  // the admin browser (RLS-gated) — no CLI.
  const [publishing, setPublishing] = useState(false);
  const publishBacklog = async () => {
    if (!window.confirm(
      "Publish all completed, unlisted designs to CreatorMarket as 'pending review'?\n\nThey won't be public until you approve them at /admin/creator-market.",
    )) return;
    setPublishing(true);
    try {
      const { data: packs, error: pErr } = await (supabase as any)
        .from("production_packs")
        .select("id, visualization_id, thumbnail_url, pack_url, vehicle_info, design_name")
        .eq("upscale_status", "complete")
        .not("thumbnail_url", "is", null)
        .limit(2000);
      if (pErr) throw pErr;
      const { data: listedRows } = await (supabase as any)
        .from("marketplace_listings").select("design_dna_id");
      const listed = new Set((listedRows || []).map((r: any) => r.design_dna_id).filter(Boolean));
      const candidates = (packs || []).filter((p: any) => !listed.has(p.id));
      if (!candidates.length) {
        toast.info("No unlisted completed designs found in production_packs. Use ‘Pick from Design Library’ to publish individual renders.", { duration: 9000 });
        return;
      }

      // Pull render_urls (all sides) for the candidates in batches.
      const vizIds = [...new Set(candidates.map((p: any) => p.visualization_id).filter(Boolean))] as string[];
      const vizMap: Record<string, any> = {};
      for (let i = 0; i < vizIds.length; i += 200) {
        const { data: vz } = await (supabase as any)
          .from("color_visualizations").select("id, render_urls").in("id", vizIds.slice(i, i + 200));
        for (const v of vz || []) vizMap[v.id] = v.render_urls;
      }

      const rows = candidates.map((p: any) => {
        const vi = p.vehicle_info || {};
        const name = p.design_name || "Custom Wrap Design";
        const trade = inferTradeCategory({ industry_title: name, title: name });
        const vehicle = [vi.year, vi.make, vi.model].filter(Boolean).join(" ");
        return {
          title: `${vehicle ? vehicle + " - " : ""}${name}`,
          industry_title: name,
          featured_creator_name: "DesignProAI Team",
          trade_category: trade,
          design_style: trade ? "branded" : "custom",
          price: 350,
          thumbnail_url: p.thumbnail_url,
          render_urls: vizMap[p.visualization_id] || { hero: p.thumbnail_url },
          production_pack_url: p.pack_url || null,
          description: buildSeoDescription({
            industry_title: name, title: name, trade_category: trade,
            vehicle_year: vi.year, vehicle_make: vi.make, vehicle_model: vi.model,
          }),
          vehicle_year: vi.year ? String(vi.year) : null,
          vehicle_make: vi.make || null,
          vehicle_model: vi.model || null,
          design_dna_id: p.id,
          offers_printed_wrap: false,
          is_hidden: false,
          status: "pending_review",
          listed_at: null,
        };
      });

      let ok = 0;
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100);
        const { error } = await (supabase as any).from("marketplace_listings").insert(chunk);
        if (error) { toast.error(`Stopped after ${ok} — ${error.message}`, { duration: 12000 }); break; }
        ok += chunk.length;
      }
      if (ok) {
        toast.success(`Published ${ok} design(s) as pending review. Approve them at /admin/creator-market.`, { duration: 10000 });
        await qc.invalidateQueries({ queryKey: ["admin-creatormarket-listings"] });
      }
    } catch (e) {
      toast.error(`Publish backlog failed — ${(e as Error).message}`, { duration: 12000 });
    } finally {
      setPublishing(false);
    }
  };

  const { data: listings, isLoading } = useQuery({
    queryKey: ["admin-creatormarket-listings"],
    queryFn: async () => {
      const { data, error } = await (supabase as never as { from: (t: string) => any })
        .from("marketplace_listings")
        .select(
          "id, title, thumbnail_url, vehicle_year, vehicle_make, vehicle_model, price, status, is_hidden, display_order, listed_at, view_count, favorite_count, trade_category, offers_printed_wrap, featured_creator_name",
        )
        .order("display_order", { ascending: true, nullsFirst: false })
        .order("listed_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Listing[];
    },
  });

  // Insert an admin-curated card. creator_id and design_dna_id are
  // intentionally NULL — admin curator rows are not tied to a real
  // creator profile or DNA. RLS allows admins full access (see the
  // creatormarket_admin_curated_cards migration).
  const submitNewCard = async (status: "listed" | "draft") => {
    const errors: string[] = [];
    if (!form.title.trim()) errors.push("Title is required");
    if (!form.featured_creator_name.trim()) errors.push("Created by (creator name) is required");
    if (!form.thumbnail_url.trim()) errors.push("Thumbnail URL is required");
    const filledViews = Object.values(form.views).filter((v) => v.trim()).length;
    if (filledViews === 0) errors.push("At least one 3D view URL is required");
    if (errors.length) {
      toast.error(errors.join(" · "));
      return;
    }
    const priceNum = Number(form.price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      toast.error("Price must be a positive number");
      return;
    }

    setCreating(true);
    try {
      // Strip empty view URLs so render_urls is a clean object.
      const renderUrls: Record<string, string> = {};
      for (const v of VIEW_FIELDS) {
        const url = form.views[v.key]?.trim();
        if (url) renderUrls[v.key] = url;
      }

      const insertRow: Record<string, unknown> = {
        title: form.title.trim(),
        industry_title: form.industry_title.trim() || null,
        vehicle_year: form.vehicle_year.trim() || null,
        vehicle_make: form.vehicle_make.trim() || null,
        vehicle_model: form.vehicle_model.trim() || null,
        featured_creator_name: form.featured_creator_name.trim(),
        trade_category: form.trade_category || null,
        design_style: form.design_style,
        price: priceNum,
        thumbnail_url: form.thumbnail_url.trim(),
        panel_2d_url: form.panel_2d_url.trim() || null,
        install_video_url: form.install_video_url.trim() || null,
        render_urls: renderUrls,
        offers_printed_wrap: form.offers_printed_wrap,
        status,
        is_hidden: false,
        listed_at: status === "listed" ? new Date().toISOString() : null,
      };

      const { error } = await (supabase as never as { from: (t: string) => any })
        .from("marketplace_listings")
        .insert(insertRow);
      if (error) throw error;

      toast.success(status === "listed" ? "Card published live" : "Card saved as draft");
      setForm(EMPTY_FORM);
      setShowCreate(false);
      await qc.invalidateQueries({ queryKey: ["admin-creatormarket-listings"] });
    } catch (e) {
      toast.error(`Create failed — ${(e as Error).message}`);
    } finally {
      setCreating(false);
    }
  };

  // Sort client-side too — Supabase's NULLS-LAST quirk varies by driver.
  const sorted = useMemo(() => {
    if (!listings) return [] as Listing[];
    return [...listings].sort((a, b) => {
      const ao = a.display_order ?? Number.POSITIVE_INFINITY;
      const bo = b.display_order ?? Number.POSITIVE_INFINITY;
      if (ao !== bo) return ao - bo;
      const at = a.listed_at ? Date.parse(a.listed_at) : 0;
      const bt = b.listed_at ? Date.parse(b.listed_at) : 0;
      return bt - at;
    });
  }, [listings]);

  const updateRow = async (id: string, patch: Record<string, unknown>) => {
    setBusyId(id);
    try {
      const { error } = await (supabase as never as { from: (t: string) => any })
        .from("marketplace_listings")
        .update(patch)
        .eq("id", id);
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["admin-creatormarket-listings"] });
    } catch (e) {
      toast.error(`Update failed — ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const toggleHidden = (l: Listing) => updateRow(l.id, { is_hidden: !l.is_hidden });

  const pinToTop = (l: Listing) => updateRow(l.id, { display_order: 0 });

  const unpin = (l: Listing) => updateRow(l.id, { display_order: null });

  // Move-up / move-down: swap display_order with the adjacent visible
  // sibling. If a row has no display_order yet, give it a fresh number
  // based on its current position before swapping.
  const moveBy = async (index: number, delta: -1 | 1) => {
    const list = sorted;
    const target = list[index];
    const swapWith = list[index + delta];
    if (!target || !swapWith) return;
    // Compute fresh orders if either side is null. We backfill the
    // whole window of relevant rows so the swap is well-defined.
    const updates: { id: string; display_order: number }[] = [];
    let lastSeen = 0;
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      const nextOrder =
        row.display_order ?? Math.max(lastSeen + 1, i + 1);
      lastSeen = nextOrder;
      if (row.display_order !== nextOrder) {
        updates.push({ id: row.id, display_order: nextOrder });
      }
    }
    // Persist any backfill writes first so target + swapWith have
    // real numbers to swap.
    if (updates.length) {
      setBusyId(target.id);
      try {
        for (const u of updates) {
          await (supabase as never as { from: (t: string) => any })
            .from("marketplace_listings")
            .update({ display_order: u.display_order })
            .eq("id", u.id);
        }
      } finally {
        setBusyId(null);
      }
    }
    // Now swap with the latest persisted values.
    const freshA =
      updates.find((u) => u.id === target.id)?.display_order ??
      target.display_order ??
      0;
    const freshB =
      updates.find((u) => u.id === swapWith.id)?.display_order ??
      swapWith.display_order ??
      0;
    setBusyId(target.id);
    try {
      const db = supabase as never as { from: (t: string) => any };
      await db
        .from("marketplace_listings")
        .update({ display_order: freshB })
        .eq("id", target.id);
      await db
        .from("marketplace_listings")
        .update({ display_order: freshA })
        .eq("id", swapWith.id);
      await qc.invalidateQueries({
        queryKey: ["admin-creatormarket-listings"],
      });
    } catch (e) {
      toast.error(`Reorder failed — ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0d] text-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <Link
          to="/admin"
          className="inline-flex items-center gap-1 text-xs text-white/55 hover:text-white mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to admin
        </Link>

        <div className="rounded-2xl border border-white/10 bg-[#101018] p-6 sm:p-8 mb-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-fuchsia-300 mb-2">
            CreatorMarket
          </div>
          <h1 className="font-montserrat text-2xl sm:text-3xl font-bold mb-2">
            Listing manager
          </h1>
          <p className="text-sm text-white/60 leading-relaxed">
            Curate the public <code className="px-1 py-0.5 rounded bg-white/5 border border-white/10 text-[11px]">/creatormarket</code>
            {" "}page. Hide listings, pin your best work to the top, or
            use the up / down arrows to nudge a row. All changes are
            live the next time a customer loads the page.
          </p>
          <button
            type="button"
            onClick={publishBacklog}
            disabled={publishing}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-60 px-4 py-2.5 text-sm font-bold text-white transition"
          >
            {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {publishing ? "Publishing backlog…" : "Publish backlog → CreatorMarket"}
          </button>
          <p className="text-[11px] text-white/45 mt-1.5">
            Lists every completed, unlisted design as “pending review” (approve at <code className="px-1 rounded bg-white/5">/admin/creator-market</code>).
          </p>
        </div>

        {/* ── Design Library picker (assign a pre-designed job) ── */}
        {showLibrary && (
          <div
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
            onClick={() => setShowLibrary(false)}
          >
            <div
              className="w-full max-w-4xl bg-[#101018] border border-white/10 rounded-2xl mt-8 mb-8"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                <div>
                  <div className="text-sm font-bold text-white">Design Library</div>
                  <div className="text-[11px] text-white/55">Pick a pre-rendered design — it auto-fills the card images + vehicle. Then type the business name and publish.</div>
                </div>
                <button onClick={() => setShowLibrary(false)} className="text-white/50 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4">
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                  <input
                    value={librarySearch}
                    onChange={(e) => setLibrarySearch(e.target.value)}
                    placeholder="Search by make / model / design name…"
                    className="w-full bg-[#1a1a22] border border-white/15 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-500/60"
                  />
                </div>
                {libraryLoading ? (
                  <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-fuchsia-400" /></div>
                ) : (designLibrary || []).length === 0 ? (
                  <div className="text-center py-16 text-white/50 text-sm">No designs found — try a different search.</div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {(designLibrary || []).map((d: any) => {
                      const t = libThumb(d.render_urls);
                      const veh = [d.vehicle_year, d.vehicle_make, d.vehicle_model].filter(Boolean).join(" ");
                      const nViews = d.render_urls && typeof d.render_urls === "object"
                        ? Object.values(d.render_urls).filter((v) => typeof v === "string" && (v as string).startsWith("http")).length
                        : 0;
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => pickDesign(d)}
                          title={`Loads all ${nViews} side${nViews === 1 ? "" : "s"} into the card`}
                          className="group text-left rounded-lg overflow-hidden border border-white/10 hover:border-fuchsia-400/50 transition"
                        >
                          <div className="relative aspect-video bg-[#1a1a22] overflow-hidden">
                            {t && <img src={t} alt={veh || "design"} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />}
                            <span className="absolute bottom-1 right-1 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-black/60 text-white/90 backdrop-blur-sm">
                              {nViews} side{nViews === 1 ? "" : "s"}
                            </span>
                          </div>
                          <div className="px-2 py-1.5">
                            <div className="text-[11px] text-white/80 truncate">{veh || d.design_file_name || "Design"}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Create-new-card panel ──────────────────────────────────
            Lets an admin drop in an entirely new CreatorMarket card —
            7 view URLs, optional 2D panel art, vehicle, price, trade,
            and a free-text "Created by" name shown on the card. The
            row is inserted with creator_id = NULL and design_dna_id =
            NULL (admin curator card); the 60/40 split is fixed in
            policy, no per-row override needed. */}
        <div className="rounded-2xl border border-white/10 bg-[#101018] mb-6 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.02] transition"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-fuchsia-500/15 border border-fuchsia-400/30 flex items-center justify-center">
                <Plus className="w-4 h-4 text-fuchsia-300" />
              </div>
              <div className="text-left">
                <div className="text-sm font-bold text-white">Create new card</div>
                <div className="text-[11px] text-white/55">
                  Paste 7 view URLs, type a creator name, publish to /creatormarket
                </div>
              </div>
            </div>
            <span className="text-[11px] text-white/55">
              {showCreate ? "Hide" : "Open"}
            </span>
          </button>

          {showCreate && (
            <div className="border-t border-white/10 p-5 sm:p-6 space-y-4">
              {/* Auto-fill from an existing design instead of pasting URLs by hand */}
              <button
                type="button"
                onClick={() => setShowLibrary(true)}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-fuchsia-400/40 bg-fuchsia-500/10 px-3 py-2.5 text-sm font-semibold text-fuchsia-200 hover:bg-fuchsia-500/20 transition"
              >
                <Images className="w-4 h-4" /> Pick from Design Library — auto-fill images
              </button>
              {/* Row 1: industry title (big customer-facing) + internal title */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-white/70 mb-1">
                    Industry title <span className="text-white/40">(big card title)</span>
                  </label>
                  <input
                    type="text"
                    value={form.industry_title}
                    onChange={(e) => setForm((f) => ({ ...f, industry_title: e.target.value }))}
                    placeholder='e.g. "HVAC Service Van Wrap"'
                    className="w-full bg-[#1a1a22] border border-white/15 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-500/60"
                  />
                  <p className="text-[10px] text-white/40 mt-1">
                    What buyers see in big bold. If empty, auto-derives
                    from the trade category.
                  </p>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-white/70 mb-1">
                    Internal title <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder='e.g. "2024 Ford F-250 — Stealth Carbon"'
                    className="w-full bg-[#1a1a22] border border-white/15 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-500/60"
                  />
                </div>
              </div>

              {/* Row 1b: Created by */}
              <div>
                <label className="block text-[11px] font-semibold text-white/70 mb-1">
                  Created by <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={form.featured_creator_name}
                  onChange={(e) => setForm((f) => ({ ...f, featured_creator_name: e.target.value }))}
                  placeholder='e.g. "DesignProAI Studios"'
                  className="w-full bg-[#1a1a22] border border-white/15 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-500/60"
                />
                <p className="text-[10px] text-white/40 mt-1">
                  Shown on the card as "Created by …". 60 / 40 split is fixed in
                  policy and does not change per card.
                </p>
              </div>

              {/* Row 2: vehicle Y / M / M */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-white/70 mb-1">Year</label>
                  <input
                    type="text"
                    value={form.vehicle_year}
                    onChange={(e) => setForm((f) => ({ ...f, vehicle_year: e.target.value }))}
                    placeholder="2024"
                    className="w-full bg-[#1a1a22] border border-white/15 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-500/60"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-white/70 mb-1">Make</label>
                  <input
                    type="text"
                    value={form.vehicle_make}
                    onChange={(e) => setForm((f) => ({ ...f, vehicle_make: e.target.value }))}
                    placeholder="Ford"
                    className="w-full bg-[#1a1a22] border border-white/15 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-500/60"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-white/70 mb-1">Model</label>
                  <input
                    type="text"
                    value={form.vehicle_model}
                    onChange={(e) => setForm((f) => ({ ...f, vehicle_model: e.target.value }))}
                    placeholder="F-250"
                    className="w-full bg-[#1a1a22] border border-white/15 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-500/60"
                  />
                </div>
              </div>

              {/* Row 3: trade / design style / price */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-white/70 mb-1">Trade category</label>
                  <select
                    value={form.trade_category}
                    onChange={(e) => setForm((f) => ({ ...f, trade_category: e.target.value }))}
                    className="w-full bg-[#1a1a22] border border-white/15 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-fuchsia-500/60"
                  >
                    <option value="">No trade</option>
                    {ADMIN_TRADE_OPTIONS.map((t) => (
                      <option key={t.slug} value={t.slug}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-white/70 mb-1">Design style</label>
                  <select
                    value={form.design_style}
                    onChange={(e) => setForm((f) => ({ ...f, design_style: e.target.value as NewCardForm["design_style"] }))}
                    className="w-full bg-[#1a1a22] border border-white/15 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-fuchsia-500/60"
                  >
                    <option value="custom">Custom</option>
                    <option value="branded">Branded (name editable)</option>
                    <option value="fleet">Fleet</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-white/70 mb-1">Price (USD)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                    className="w-full bg-[#1a1a22] border border-white/15 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-fuchsia-500/60"
                  />
                </div>
              </div>

              {/* Row 4: thumbnail + 2D panel art */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-white/70 mb-1">
                    Card thumbnail URL <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="url"
                    value={form.thumbnail_url}
                    onChange={(e) => setForm((f) => ({ ...f, thumbnail_url: e.target.value }))}
                    placeholder="https://…/hero.jpg"
                    className="w-full bg-[#1a1a22] border border-white/15 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-500/60"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-white/70 mb-1">
                    2D panel art URL <span className="text-white/40">(optional)</span>
                  </label>
                  <input
                    type="url"
                    value={form.panel_2d_url}
                    onChange={(e) => setForm((f) => ({ ...f, panel_2d_url: e.target.value }))}
                    placeholder="https://…/flat-panel.png"
                    className="w-full bg-[#1a1a22] border border-white/15 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-500/60"
                  />
                </div>
              </div>

              {/* Install video — vertical 9:16 reels-style supported.
                  When set, the public detail modal grows a third
                  "Real Install" tab. */}
              <div>
                <label className="block text-[11px] font-semibold text-white/70 mb-1">
                  Install video URL <span className="text-white/40">(optional — Instagram, YouTube, Vimeo, or mp4)</span>
                </label>
                <input
                  type="url"
                  value={form.install_video_url}
                  onChange={(e) => setForm((f) => ({ ...f, install_video_url: e.target.value }))}
                  placeholder="https://instagram.com/reel/… or https://youtube.com/shorts/…"
                  className="w-full bg-[#1a1a22] border border-white/15 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-500/60"
                />
                <p className="text-[10px] text-white/40 mt-1">
                  Vertical 9:16 reels work great. When set, customers see
                  a "Real Install" tab in the listing detail modal.
                </p>
              </div>

              {/* 7-view grid (3D vehicle renders) */}
              <div>
                <div className="flex items-baseline justify-between mb-2">
                  <label className="text-[11px] font-semibold text-white/70">
                    3D vehicle views <span className="text-rose-400">*</span>
                  </label>
                  <span className="text-[10px] text-white/40">
                    At least one URL required. Empty slots are skipped.
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {VIEW_FIELDS.map((v) => (
                    <div key={v.key}>
                      <label className="block text-[10px] text-white/55 mb-0.5">{v.label}</label>
                      <input
                        type="url"
                        value={form.views[v.key]}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            views: { ...f.views, [v.key]: e.target.value },
                          }))
                        }
                        placeholder="https://…"
                        className="w-full bg-[#1a1a22] border border-white/15 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-500/60"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Wrap-shipping toggle */}
              <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer w-fit">
                <input
                  type="checkbox"
                  checked={form.offers_printed_wrap}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, offers_printed_wrap: e.target.checked }))
                  }
                  className="accent-emerald-400"
                />
                <Truck className="w-3.5 h-3.5 text-emerald-300" />
                Offer "Design + Printed Wrap Shipped USA"
              </label>

              {/* Action row */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/5">
                <Button
                  type="button"
                  disabled={creating}
                  onClick={() => submitNewCard("listed")}
                  className="bg-fuchsia-500 hover:bg-fuchsia-400 text-black font-bold gap-1.5"
                >
                  {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Publish live
                </Button>
                <Button
                  type="button"
                  disabled={creating}
                  variant="outline"
                  onClick={() => submitNewCard("draft")}
                  className="border-white/20 text-white/80 hover:text-white hover:bg-white/5 gap-1.5"
                >
                  Save as draft
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { setForm(EMPTY_FORM); setShowCreate(false); }}
                  className="text-white/55 hover:text-white hover:bg-white/5 gap-1.5"
                >
                  <X className="w-3.5 h-3.5" />
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="rounded-2xl border border-white/10 bg-[#101018] p-8 text-center text-sm text-white/60">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-3" />
            Loading listings…
          </div>
        ) : sorted.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#101018] p-8 text-center">
            <AlertCircle className="w-6 h-6 text-amber-300 mx-auto mb-3" />
            <div className="text-sm text-white/75">
              No listings yet. Creators publish to CreatorMarket via{" "}
              <code className="px-1 py-0.5 rounded bg-white/5 border border-white/10 text-[11px]">
                /admin/creator-market
              </code>
              .
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-[#101018] overflow-hidden">
            <ul className="divide-y divide-white/5">
              {sorted.map((l, i) => {
                const vehicle = [l.vehicle_year, l.vehicle_make, l.vehicle_model]
                  .filter(Boolean)
                  .join(" ")
                  .trim();
                const isBusy = busyId === l.id;
                return (
                  <li
                    key={l.id}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3",
                      l.is_hidden && "opacity-50",
                    )}
                  >
                    {/* Order pill */}
                    <div className="shrink-0 w-9 text-center text-[11px] text-white/55 font-mono">
                      {l.display_order ?? "·"}
                    </div>

                    {/* Thumb */}
                    <div className="shrink-0 w-16 h-12 rounded-lg overflow-hidden border border-white/10 bg-[#1a1a22]">
                      {l.thumbnail_url ? (
                        <img
                          src={l.thumbnail_url}
                          alt={l.title ?? "listing"}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[9px] text-white/30 uppercase">
                          no img
                        </div>
                      )}
                    </div>

                    {/* Title + vehicle */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate">
                        {l.title ?? "(untitled)"}
                      </div>
                      <div className="text-[11px] text-white/50 truncate">
                        {vehicle || "—"} · {l.status ?? "draft"}
                        {l.price ? ` · $${Number(l.price).toLocaleString()}` : ""}
                        {l.view_count ? ` · 👁 ${l.view_count}` : ""}
                        {l.featured_creator_name ? ` · by ${l.featured_creator_name}` : ""}
                      </div>
                      {/* Trade tag + offers-printed-wrap controls.
                          Trade dropdown writes marketplace_listings
                          .trade_category; toggle writes
                          .offers_printed_wrap. Both flip the public
                          CreatorMarket card behavior. */}
                      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                        <select
                          value={l.trade_category ?? ""}
                          disabled={isBusy}
                          onChange={(e) =>
                            updateRow(l.id, {
                              trade_category: e.target.value || null,
                            })
                          }
                          className="text-[10px] bg-[#1a1a22] border border-white/15 rounded px-1.5 py-0.5 text-white/80 focus:outline-none focus:border-fuchsia-500/50"
                        >
                          <option value="">No trade</option>
                          {ADMIN_TRADE_OPTIONS.map((t) => (
                            <option key={t.slug} value={t.slug}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            updateRow(l.id, {
                              offers_printed_wrap: !l.offers_printed_wrap,
                            })
                          }
                          className={cn(
                            "inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border transition",
                            l.offers_printed_wrap
                              ? "bg-emerald-500/15 border-emerald-400/40 text-emerald-200"
                              : "bg-white/[0.02] border-white/15 text-white/55 hover:text-white",
                          )}
                          title="Toggle 'Design + Printed Wrap Shipped USA' button on the public card"
                        >
                          <Truck className="w-3 h-3" />
                          {l.offers_printed_wrap ? "Wrap shipping ON" : "Wrap shipping OFF"}
                        </button>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="shrink-0 flex items-center gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={isBusy || i === 0}
                        onClick={() => moveBy(i, -1)}
                        className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/5"
                        aria-label="Move up"
                        title="Move up"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={isBusy || i === sorted.length - 1}
                        onClick={() => moveBy(i, 1)}
                        className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/5"
                        aria-label="Move down"
                        title="Move down"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={isBusy}
                        onClick={() =>
                          (l.display_order === 0 ? unpin(l) : pinToTop(l))
                        }
                        className={cn(
                          "h-8 w-8 hover:bg-white/5",
                          l.display_order === 0
                            ? "text-cyan-300"
                            : "text-white/70 hover:text-white",
                        )}
                        aria-label={l.display_order === 0 ? "Unpin from top" : "Pin to top"}
                        title={l.display_order === 0 ? "Unpin from top" : "Pin to top"}
                      >
                        <Pin className="w-4 h-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={isBusy}
                        onClick={() => toggleHidden(l)}
                        className={cn(
                          "h-8 w-8 hover:bg-white/5",
                          l.is_hidden
                            ? "text-rose-300"
                            : "text-white/70 hover:text-white",
                        )}
                        aria-label={l.is_hidden ? "Show on CreatorMarket" : "Hide from CreatorMarket"}
                        title={l.is_hidden ? "Show on CreatorMarket" : "Hide from CreatorMarket"}
                      >
                        {l.is_hidden ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
