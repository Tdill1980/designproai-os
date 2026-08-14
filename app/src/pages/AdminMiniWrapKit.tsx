/**
 * /admin/mini-wrap-kit — 1/24 MINI WRAP KIT (EXPERIMENT, admin-only)
 *
 * Owner flow (Trish 2026-07-28): browse the CREATOR MARKET designs (so we can
 * choose) → click one → enter (or photo-identify) the EXACT vehicle the model
 * car is → build a to-scale sheet sized to THAT vehicle's GENIE dims ÷ scale.
 * WHITE UI standard (customer-facing surface): white content, dark text,
 * blue→magenta gradient as accent only; the global black header/nav stay.
 *
 * SEPARATION CONTRACT ("must be separate from pipeline"): this page and
 * src/lib/miniWrapKit.ts write NOTHING to any pipeline table. The page's only
 * edge-function calls are two existing READ-ONLY lookups — analyze-vehicle-image
 * (photo → make/model/year) and panelizer-step-validate (GENIE dims resolver).
 * Output PNGs land only in wrap-files/mini-wrap-kits/. No pipeline surface
 * links here; the page is reachable only by URL.
 */

import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { buildMiniWrapKit, type MiniKitSideDims, type MiniWrapKitResult } from "@/lib/miniWrapKit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Box, Loader2, Printer, ExternalLink, AlertTriangle, CheckCircle2, Ruler,
  Camera, Car, Search, ImageOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

const SCALES = [
  { value: 18, label: "1/18 — large die-cast" },
  { value: 24, label: "1/24 — standard die-cast (default)" },
  { value: 25, label: "1/25 — US model kits" },
  { value: 32, label: "1/32 — slot car" },
  { value: 43, label: "1/43 — collector" },
  { value: 64, label: "1/64 — Hot Wheels" },
];
const PAPERS = [
  { value: "11x17", label: '11" × 17" tabloid (default)' },
  { value: "letter", label: '8.5" × 11" letter' },
  { value: "12x18", label: '12" × 18"' },
];

interface MarketDesignCard {
  listingId: string;
  generationId: string | null;
  name: string;
  vehicle: string;
  thumb: string | null;
  hasPanels: boolean;
}

export default function AdminMiniWrapKit() {
  const [selectedListing, setSelectedListing] = useState("");
  const [manualId, setManualId] = useState("");
  const [designSearch, setDesignSearch] = useState("");
  const [scale, setScale] = useState(24);
  const [paper, setPaper] = useState("11x17");
  const [vehYear, setVehYear] = useState("");
  const [vehMake, setVehMake] = useState("");
  const [vehModel, setVehModel] = useState("");
  const [identifying, setIdentifying] = useState(false);
  const [modelPhoto, setModelPhoto] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [buildNote, setBuildNote] = useState("");
  const [result, setResult] = useState<MiniWrapKitResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── DESIGN BROWSER — the CreatorMarket catalog (same slim browse query the
  // public /creatormarket page uses; READ-ONLY). Each card resolves its design
  // generation id up front (design_dna_id → neuralnetwork_design_dna) and
  // badges vault-panel availability — a badge, never a filter: the honest
  // gate lives in the builder with a clear reason.
  const { data: designs = [], isLoading: designsLoading } = useQuery({
    queryKey: ["mini-wrap-kit-creatormarket-browser"],
    queryFn: async (): Promise<MarketDesignCard[]> => {
      const { data: rows, error } = await (supabase as any)
        .from("marketplace_listings")
        .select("id, title, thumbnail_url, vehicle_year, vehicle_make, vehicle_model, design_dna_id, listed_at, display_order")
        .eq("status", "listed")
        .eq("is_hidden", false)
        .order("display_order", { ascending: true, nullsFirst: false })
        .order("listed_at", { ascending: false })
        .limit(60);
      if (error) {
        console.warn("[mini-wrap-kit] listings query:", error);
        return [];
      }
      const cards: MarketDesignCard[] = (rows || []).map((r: any) => ({
        listingId: r.id,
        generationId: null,
        name: r.title || "Untitled design",
        vehicle: [r.vehicle_year, r.vehicle_make, r.vehicle_model].filter(Boolean).join(" "),
        thumb: typeof r.thumbnail_url === "string" && r.thumbnail_url.startsWith("http") ? r.thumbnail_url : null,
        hasPanels: false,
        dnaId: r.design_dna_id,
      })) as any;
      // design_dna_id → generation_id (the vault key), batched.
      const dnaIds = Array.from(new Set(cards.map((c: any) => c.dnaId).filter(Boolean)));
      if (dnaIds.length) {
        const { data: dna } = await (supabase as any)
          .from("neuralnetwork_design_dna")
          .select("id, generation_id")
          .in("id", dnaIds);
        const genByDna = new Map<string, string>((dna || []).filter((d: any) => d.generation_id).map((d: any) => [d.id, d.generation_id]));
        for (const c of cards as any[]) c.generationId = genByDna.get(c.dnaId) || null;
      }
      // Badge which designs already have vault print panels (any version).
      const genIds = Array.from(new Set(cards.map((c) => c.generationId).filter(Boolean))) as string[];
      if (genIds.length) {
        // v2 atomic rows only — the exporter reads only complete approved
        // packs, so the badge must not light up for legacy v1 files.
        const { data: pfa } = await (supabase as any)
          .from("production_flow_assets")
          .select("job_id")
          .in("job_id", genIds)
          .like("version", "v2:%")
          .not("branding_url", "is", null)
          .limit(1000);
        const withPanels = new Set((pfa || []).map((p: any) => p.job_id));
        for (const c of cards) c.hasPanels = !!c.generationId && withPanels.has(c.generationId);
      }
      return cards.filter((c) => c.thumb);
    },
  });

  const filteredDesigns = useMemo(() => {
    const q = designSearch.trim().toLowerCase();
    if (!q) return designs;
    return designs.filter((d) => `${d.name} ${d.vehicle}`.toLowerCase().includes(q));
  }, [designs, designSearch]);

  const selectedCard = designs.find((d) => d.listingId === selectedListing) || null;
  const activeGenerationId = manualId.trim() || selectedCard?.generationId || "";

  // ── MODEL-CAR PHOTO → vehicle identity (existing analyze-vehicle-image
  // function — a read-only Gemini vision lookup, no writes anywhere).
  const handlePhoto = async (file: File) => {
    setIdentifying(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setModelPhoto(dataUrl);
      const { data, error } = await (supabase as any).functions.invoke("analyze-vehicle-image", {
        body: { imageData: dataUrl },
      });
      if (error || data?.success !== true) throw new Error(data?.error || error?.message || "identification failed");
      const v = data.data || {};
      if (v.year) setVehYear(String(v.year));
      if (v.make) setVehMake(String(v.make));
      if (v.model) setVehModel(String(v.model));
      if (v.make || v.model) {
        toast.success(`Identified: ${[v.year, v.make, v.model].filter(Boolean).join(" ")} — edit if it's off.`);
      } else {
        toast.warning("Couldn't identify the vehicle from that photo — type the make/model below.");
      }
    } catch (e: any) {
      toast.error(e?.message || "Photo identification failed — type the make/model instead.");
    } finally {
      setIdentifying(false);
    }
  };

  // ── GENIE dims for the entered vehicle (panelizer-step-validate — GENIE's
  // read-only dims-resolver job; same mapping the 2D-proof composer uses).
  const resolveGenieDims = async (): Promise<MiniKitSideDims | null> => {
    if (!vehMake.trim() || !vehModel.trim()) return null;
    try {
      const { data } = await (supabase as any).functions.invoke("panelizer-step-validate", {
        body: {
          vehicleMake: vehMake.trim(), vehicleModel: vehModel.trim(), vehicleYear: vehYear.trim(),
          sideSize: "medium", addHood: true, addRear: true, addFrontBumper: true, addRearBumper: true, addRoof: true,
        },
      });
      const panels: any[] = Array.isArray(data?.panels) ? data.panels : [];
      const find = (re: RegExp) => panels.find((p) => re.test(`${p.panelKey || ""} ${p.label || ""}`.toLowerCase()));
      const side = find(/driver|(^|[^a-z])side/);
      if (!side?.widthInches) return null;
      const hood = find(/hood/);
      const roof = find(/roof|top/);
      const rear = find(/rear|back/);
      const front = find(/front/);
      const dims: MiniKitSideDims = { sideW: side.widthInches, sideH: side.heightInches };
      if (hood?.widthInches) { dims.hoodW = hood.widthInches; dims.hoodH = hood.heightInches; }
      if (roof?.widthInches) { dims.roofW = roof.widthInches; dims.roofH = roof.heightInches; }
      if (rear?.widthInches) { dims.rearW = rear.widthInches; dims.rearH = rear.heightInches; }
      if (front?.widthInches) { dims.frontW = front.widthInches; dims.frontH = front.heightInches; }
      else if (dims.rearW && dims.rearH) { dims.frontW = dims.rearW; dims.frontH = dims.rearH; }
      return dims;
    } catch {
      return null;
    }
  };

  const handleBuild = async () => {
    if (building) return;
    if (!activeGenerationId) {
      toast.error(
        selectedCard
          ? "This listing isn't linked to a design generation yet — paste its generation id manually."
          : "Pick a design (or paste a generation id) first.",
      );
      return;
    }
    setBuilding(true);
    setResult(null);
    setBuildNote("");
    try {
      const vehicleLabel = [vehYear.trim(), vehMake.trim(), vehModel.trim()].filter(Boolean).join(" ");
      let dimsOverride: MiniKitSideDims | null = null;
      if (vehMake.trim() && vehModel.trim()) {
        setBuildNote(`Resolving GENIE panel sizes for ${vehicleLabel}…`);
        dimsOverride = await resolveGenieDims();
        if (!dimsOverride) {
          toast.warning(`GENIE couldn't size "${vehicleLabel}" — using the design's original panel dims instead.`);
        }
      }
      setBuildNote("Composing the to-scale sheet…");
      const r = await buildMiniWrapKit({
        generationId: activeGenerationId,
        scale,
        paper,
        vehicle: vehicleLabel || undefined,
        title: selectedCard?.name,
        dimsOverride,
      });
      setResult(r);
      if (r.built) toast.success(`Mini wrap kit built — ${r.pages?.length} sheet${(r.pages?.length || 0) > 1 ? "s" : ""}.`);
      else toast.error(r.reason || "Build failed");
    } catch (e: any) {
      setResult({ built: false, reason: e?.message || "Build failed" });
      toast.error(e?.message || "Build failed");
    } finally {
      setBuilding(false);
      setBuildNote("");
    }
  };

  // WHITE UI standard: white surface, dark text, gradient accent only.
  const gradientText = "bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-transparent";

  return (
    <div className="min-h-screen bg-white text-gray-900 p-4 sm:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <Box className="h-6 w-6 text-gray-900" />
            <h1 className="text-2xl font-bold">
              1/24 <span className={gradientText}>Mini</span> Wrap Kit
            </h1>
            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border border-pink-300 text-pink-600 bg-pink-50">
              Experiment
            </span>
          </div>
          <p className="text-sm text-gray-600 mt-1 max-w-3xl">
            Choose a CreatorMarket design, tell it the exact vehicle your model car is (photo or typed), and
            it builds a to-scale print sheet — that vehicle's real GENIE panel inches ÷ scale, with crop marks
            and dimension labels.
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            Read-only over the vault · writes nothing to the production pipeline · print on waterslide decal
            paper or thin printable vinyl.
          </p>
        </div>

        {/* ── STEP 1: choose the CreatorMarket design ── */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 shadow-sm">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <label className="text-xs font-bold text-gray-900 uppercase tracking-wide">
              1 · Choose the design <span className="text-gray-400 font-medium normal-case">— CreatorMarket catalog</span>
            </label>
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <Input
                value={designSearch}
                onChange={(e) => setDesignSearch(e.target.value)}
                placeholder="Search designs…"
                className="bg-white border-gray-300 h-8 pl-8 text-sm w-56 text-gray-900"
              />
            </div>
          </div>

          {designsLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading CreatorMarket designs…
            </div>
          ) : filteredDesigns.length ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 max-h-[440px] overflow-y-auto pr-1">
              {filteredDesigns.map((d) => (
                <button
                  key={d.listingId}
                  type="button"
                  onClick={() => { setSelectedListing(d.listingId); setManualId(""); }}
                  className={cn(
                    "text-left rounded-lg border-2 overflow-hidden transition-all bg-white",
                    selectedListing === d.listingId && !manualId.trim()
                      ? "border-pink-500 ring-2 ring-pink-200"
                      : "border-gray-200 hover:border-gray-400",
                  )}
                >
                  <div className="relative aspect-video bg-gray-100">
                    <img src={d.thumb!} alt={d.name} className="w-full h-full object-cover" loading="lazy" />
                    {d.hasPanels && (
                      <span className="absolute top-1.5 right-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500 text-white">
                        PANELS READY
                      </span>
                    )}
                  </div>
                  <div className="px-2 py-1.5">
                    <p className="text-xs font-semibold text-gray-900 truncate">{d.name}</p>
                    <p className="text-[10px] text-gray-500 truncate">{d.vehicle || "—"}</p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-sm text-gray-500 py-8">
              <ImageOff className="h-6 w-6 text-gray-400" />
              No listed CreatorMarket designs found.
            </div>
          )}

          <Input
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            placeholder="…or paste a design generation id directly"
            className="bg-white border-gray-300 font-mono text-xs text-gray-900"
          />
        </div>

        {/* ── STEP 2: the exact vehicle the model car is ── */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 shadow-sm">
          <label className="text-xs font-bold text-gray-900 uppercase tracking-wide flex items-center gap-1.5">
            <Car className="h-3.5 w-3.5" /> 2 · The exact vehicle your model is
          </label>
          <div className="flex flex-wrap items-start gap-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={identifying}
              className="flex flex-col items-center justify-center gap-1.5 w-44 h-28 rounded-lg border-2 border-dashed border-gray-300 hover:border-pink-400 text-gray-500 hover:text-pink-600 transition-colors bg-gray-50 disabled:opacity-50 overflow-hidden"
            >
              {modelPhoto ? (
                <img src={modelPhoto} alt="model car" className="w-full h-full object-cover" />
              ) : identifying ? (
                <><Loader2 className="h-5 w-5 animate-spin" /><span className="text-[11px] font-semibold">Identifying…</span></>
              ) : (
                <><Camera className="h-5 w-5" /><span className="text-[11px] font-semibold text-center px-2">Upload a photo of the model car</span></>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhoto(f); e.target.value = ""; }}
            />
            <div className="flex-1 min-w-[260px] grid grid-cols-3 gap-2">
              <div className="col-span-3 text-[11px] text-gray-500">
                Photo auto-fills these — or just type them. GENIE sizes every panel to this exact vehicle.
              </div>
              <Input value={vehYear} onChange={(e) => setVehYear(e.target.value)} placeholder="Year" className="bg-white border-gray-300 text-sm text-gray-900" />
              <Input value={vehMake} onChange={(e) => setVehMake(e.target.value)} placeholder="Make (e.g. Cadillac)" className="bg-white border-gray-300 text-sm text-gray-900" />
              <Input value={vehModel} onChange={(e) => setVehModel(e.target.value)} placeholder="Model (e.g. Escalade ESV)" className="bg-white border-gray-300 text-sm text-gray-900" />
              <div className="col-span-3 text-[11px] text-gray-400">
                Leave blank to use the design's original vehicle dimensions.
              </div>
            </div>
          </div>
        </div>

        {/* ── STEP 3: scale + paper + build ── */}
        <div className="rounded-xl border border-gray-200 bg-white p-4 grid grid-cols-1 sm:grid-cols-2 gap-4 shadow-sm">
          <div>
            <label className="text-xs font-bold text-gray-900 uppercase tracking-wide block mb-1.5">3 · Model scale</label>
            <select
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              className="w-full rounded-md bg-white border border-gray-300 px-3 py-2 text-sm text-gray-900"
            >
              {SCALES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-gray-900 uppercase tracking-wide block mb-1.5">Paper</label>
            <select
              value={paper}
              onChange={(e) => setPaper(e.target.value)}
              className="w-full rounded-md bg-white border border-gray-300 px-3 py-2 text-sm text-gray-900"
            >
              {PAPERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
        </div>

        <Button
          onClick={handleBuild}
          disabled={(!activeGenerationId && !selectedCard) || building}
          className="w-full gap-2 bg-gradient-to-r from-blue-500 to-pink-500 hover:from-blue-600 hover:to-pink-600 text-white font-bold py-5 min-h-[52px]"
        >
          {building ? <Loader2 className="h-5 w-5 animate-spin" /> : <Printer className="h-5 w-5" />}
          {building ? (buildNote || "Creating mini kit…") : `Create 1/${scale} Mini Kit`}
        </Button>

        {/* Honest failure */}
        {result && !result.built && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Can't build this kit</p>
              <p className="text-sm text-amber-700 mt-0.5">{result.reason}</p>
            </div>
          </div>
        )}

        {/* Result */}
        {result?.built && (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <p className="text-sm font-bold text-emerald-800">
                  {result.pages?.length} sheet{(result.pages?.length || 0) > 1 ? "s" : ""} ready — 1/{result.scale} on {PAPERS.find((p) => p.value === result.paper)?.label || result.paper} @ {result.dpi} DPI
                </p>
              </div>
              <p className="text-xs text-emerald-700">
                Print at <span className="font-bold">100% size</span> (never "fit to page"), cut at the crop
                marks, and the panels land at exact 1/{result.scale} scale.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(result.pages || []).map((p) => (
                <a
                  key={p.page}
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group rounded-xl border border-gray-200 hover:border-pink-400 overflow-hidden bg-white shadow-sm"
                >
                  <img src={p.url} alt={`Sheet page ${p.page}`} className="w-full aspect-[17/11] object-contain bg-white" loading="lazy" />
                  <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100">
                    <span className="text-xs font-semibold text-gray-900">Page {p.page}</span>
                    <span className="text-[11px] text-pink-600 inline-flex items-center gap-1 font-semibold">
                      Open full size <ExternalLink className="h-3 w-3" />
                    </span>
                  </div>
                </a>
              ))}
            </div>

            {!!result.sides?.length && (
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <Ruler className="h-4 w-4 text-gray-500" />
                  <p className="text-xs font-bold text-gray-900 uppercase tracking-wide">Panel sizes</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                  {result.sides.map((s) => (
                    <p key={s.side} className="text-sm text-gray-700">
                      <span className="font-semibold text-gray-900">{s.side}</span>
                      <span className="text-gray-500"> · {s.miniWidthIn}″ × {s.miniHeightIn}″ (real {s.realWidthIn}″ × {s.realHeightIn}″)</span>
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
