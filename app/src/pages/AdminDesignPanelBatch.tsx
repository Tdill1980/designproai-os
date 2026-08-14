import { useState, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Zap, Play, Square, Loader2, XCircle, Star, Clock, RefreshCw,
  Layers, CheckCircle2, Image as ImageIcon, Trash2, Download,
  Eye, EyeOff, Pencil, Save, History, LayoutGrid, Sparkles, Wand2, Upload,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { getRandomPresets, type PromptPreset } from "@/data/prompt-presets";

/* ================================================================ */
/* Types                                                            */
/* ================================================================ */

interface PanelJob {
  id: string;
  prompt: PromptPreset;
  finish: "Gloss" | "Satin" | "Matte";
  status: "queued" | "running" | "done" | "failed";
  panelUrl: string | null;
  designName: string | null;
  patternId: string | null;
  error: string | null;
  startedAt: number | null;
  durationMs: number | null;
}

interface GalleryPanel {
  id: string;
  name: string;
  ai_generated_name: string | null;
  category: string | null;
  media_url: string;
  thumbnail_url: string | null;
  clean_display_url: string | null;
  production_file_url: string | null;
  is_active: boolean | null;
  is_curated: boolean | null;
  sort_order: number | null;
  created_at: string | null;
  prompt_text: string | null;
  finish: string | null;
}

const FINISHES: PanelJob["finish"][] = ["Gloss", "Satin", "Matte"];
const db = supabase as any;

/* ================================================================ */
/* Star Rating                                                      */
/* ================================================================ */
function StarRating({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <button key={s} onClick={() => onChange(s)} className="p-0 bg-transparent border-none cursor-pointer">
          <Star className={cn("h-4 w-4 transition-colors", s <= (value || 0) ? "text-yellow-400 fill-yellow-400" : "text-zinc-600 hover:text-yellow-300")} />
        </button>
      ))}
    </div>
  );
}

/* ================================================================ */
/* Download helper                                                  */
/* ================================================================ */
const downloadImage = async (imageUrl: string, name: string) => {
  try {
    const resp = await fetch(imageUrl);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(name || "panel-design").replace(/\s+/g, "-").toLowerCase()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Download started");
  } catch {
    toast.error("Download failed");
  }
};

/* ================================================================ */
/* Main Page                                                        */
/* ================================================================ */

export default function AdminDesignPanelBatch() {
  const queryClient = useQueryClient();

  /* ── Generator state ──────────────────────────────────────────── */
  const [category, setCategory] = useState<"restyle" | "commercial">("restyle");
  const [batchSize, setBatchSize] = useState(10);
  const [jobs, setJobs] = useState<PanelJob[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const shouldStopRef = useRef(false);
  const [completedCount, setCompletedCount] = useState(0);
  const [ratings, setRatings] = useState<Record<string, number>>({});

  /* ── Gallery manager state ────────────────────────────────────── */
  const [galleryFilter, setGalleryFilter] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

  /* ── Edit & Redo dialog state ─────────────────────────────────── */
  const [editTarget, setEditTarget] = useState<{
    imageUrl: string;
    patternId: string | null;
    name: string;
    finish?: PanelJob["finish"];
    jobIndex?: number;
    galleryId?: string;
  } | null>(null);
  const [editInstruction, setEditInstruction] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);

  /* ── Single upload state ───────────────────────────────────────── */
  const [singleFile, setSingleFile] = useState<File | null>(null);
  const [singlePreview, setSinglePreview] = useState<string | null>(null);
  const [singleUrl, setSingleUrl] = useState("");
  const [singleName, setSingleName] = useState("");
  const [singleFinish, setSingleFinish] = useState<PanelJob["finish"]>("Gloss");
  const [singleCategory, setSingleCategory] = useState<"restyle" | "commercial">("restyle");
  const [singleRunning, setSingleRunning] = useState(false);
  const [singleResult, setSingleResult] = useState<{ panelUrl: string; designName: string } | null>(null);
  const singleFileRef = useRef<HTMLInputElement>(null);

  const handleSingleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSingleFile(file);
    setSingleUrl("");
    const reader = new FileReader();
    reader.onload = () => setSinglePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const clearSingleUpload = () => {
    setSingleFile(null);
    setSinglePreview(null);
    setSingleUrl("");
    setSingleResult(null);
    if (singleFileRef.current) singleFileRef.current.value = "";
  };

  const runSingleGenerate = async () => {
    // Need either a file or a URL
    let renderUrl = singleUrl.trim();

    if (singleFile && !renderUrl) {
      // Upload file to storage first
      setSingleRunning(true);
      try {
        const ext = singleFile.name.split(".").pop() || "png";
        const path = `panels/uploads/${Date.now()}_render.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("wrap-files")
          .upload(path, singleFile, { contentType: singleFile.type, upsert: true });
        if (upErr) throw new Error("Upload failed: " + upErr.message);
        const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(path);
        renderUrl = publicUrl;
      } catch (err: any) {
        toast.error(err.message || "Upload failed");
        setSingleRunning(false);
        return;
      }
    }

    if (!renderUrl) {
      toast.error("Upload an image or paste a render URL");
      return;
    }

    setSingleRunning(true);
    setSingleResult(null);

    try {
      const { data, error } = await supabase.functions.invoke("generate-flat-panel-from-render", {
        body: {
          renderUrl,
          sideName: "full_wrap",
          prompt: singleName.trim() || "Custom panel design",
          finish: singleFinish,
          category: singleCategory,
        },
      });

      if (error) {
        const detail = (data as any)?.error || error.message;
        throw new Error(detail || "Generation failed");
      }

      const firstSuccess = (data as any)?.results?.find((r: any) => r.success);
      if (!firstSuccess?.panelUrl) throw new Error("No panel returned");

      setSingleResult({
        panelUrl: firstSuccess.panelUrl,
        designName: (data as any)?.designName || singleName || "Custom Panel",
      });

      queryClient.invalidateQueries({ queryKey: ["panel-gallery"] });
      toast.success(`Panel generated: "${(data as any)?.designName || "Custom Panel"}"`);
    } catch (err: any) {
      toast.error(err.message || "Generation failed");
    } finally {
      setSingleRunning(false);
    }
  };

  /* ── Side Panel generator (mobile-friendly mirror of QC Artboard's
       Single Panel Generator). Lives alongside the existing Upload tab so
       the original flow is untouched, but adds a per-side picker so the
       function call is no longer locked to "full_wrap". */
  const SIDE_OPTIONS = [
    { value: "driver_side", label: "Driver Side" },
    { value: "passenger_side", label: "Passenger Side" },
    { value: "hood", label: "Hood" },
    { value: "roof", label: "Roof" },
    { value: "rear", label: "Rear" },
    { value: "front", label: "Front" },
    { value: "full_wrap", label: "Full Wrap" },
  ] as const;
  type SideKey = typeof SIDE_OPTIONS[number]["value"];

  const [sideFile, setSideFile] = useState<File | null>(null);
  const [sidePreview, setSidePreview] = useState<string | null>(null);
  const [sideUrl, setSideUrl] = useState("");
  const [sideName, setSideName] = useState("");
  const [sideFinish, setSideFinish] = useState<PanelJob["finish"]>("Gloss");
  const [sideCategory, setSideCategory] = useState<"restyle" | "commercial">("restyle");
  const [sideKey, setSideKey] = useState<SideKey>("driver_side");
  const [sideRunning, setSideRunning] = useState(false);
  const [sideResult, setSideResult] = useState<{ panelUrl: string; designName: string; side: SideKey } | null>(null);
  const sideFileRef = useRef<HTMLInputElement>(null);

  const handleSidePanelFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSideFile(file);
    setSideUrl("");
    const reader = new FileReader();
    reader.onload = () => setSidePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const clearSidePanel = () => {
    setSideFile(null);
    setSidePreview(null);
    setSideUrl("");
    setSideResult(null);
    if (sideFileRef.current) sideFileRef.current.value = "";
  };

  const runSideGenerate = async () => {
    let renderUrl = sideUrl.trim();

    if (sideFile && !renderUrl) {
      setSideRunning(true);
      try {
        const ext = sideFile.name.split(".").pop() || "png";
        const path = `panels/uploads/${Date.now()}_side.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("wrap-files")
          .upload(path, sideFile, { contentType: sideFile.type, upsert: true });
        if (upErr) throw new Error("Upload failed: " + upErr.message);
        const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(path);
        renderUrl = publicUrl;
      } catch (err: any) {
        toast.error(err.message || "Upload failed");
        setSideRunning(false);
        return;
      }
    }

    if (!renderUrl) {
      toast.error("Upload an image or paste a render URL");
      return;
    }

    setSideRunning(true);
    setSideResult(null);

    try {
      const { data, error } = await supabase.functions.invoke("generate-flat-panel-from-render", {
        body: {
          renderUrl,
          sideName: sideKey,
          prompt: sideName.trim() || "Custom panel design",
          finish: sideFinish,
          category: sideCategory,
        },
      });

      if (error) {
        const detail = (data as any)?.error || error.message;
        throw new Error(detail || "Generation failed");
      }

      const firstSuccess = (data as any)?.results?.find((r: any) => r.success);
      if (!firstSuccess?.panelUrl) throw new Error("No panel returned");

      setSideResult({
        panelUrl: firstSuccess.panelUrl,
        designName: (data as any)?.designName || sideName || "Custom Panel",
        side: sideKey,
      });

      queryClient.invalidateQueries({ queryKey: ["panel-gallery"] });
      toast.success(`Panel generated: "${(data as any)?.designName || "Custom Panel"}"`);
    } catch (err: any) {
      toast.error(err.message || "Generation failed");
    } finally {
      setSideRunning(false);
    }
  };

  /* ── Proof → Artboard (multi-panel) — RETIRED (roadmap #5, retire on sight) ──
       Used to orchestrate server-side via generate-artboard-from-proof, a DEAD
       pipeline that cropped the truck-render proof into WRONG CROPS; the
       function itself is no longer deployed. Panel/artboard production now
       runs through the ONE sanctioned chain: Build Assets / RevisionStudio
       (Production Layers → Build print panels) → the deterministic gridslice
       + proof extract → production_flow_assets → the PanelPro Studio Board's
       QC checklist → QC Stamp → WrapBox. This section stays in place (so
       nothing 404s) but just points operators at that pipeline instead. */
  interface ProofPanel { label: string; panelKey: string; widthInches: number; heightInches: number; }
  interface ProofSidePanel { side: string; label: string; panelUrl: string | null; }
  interface ProofResult {
    artboardUrl: string;
    vehicleName: string;
    totalSqFt: number;
    dimsVerified: boolean;
    panels: ProofPanel[];
    sidePanels: ProofSidePanel[];
    failedSides: string[];
  }

  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [proofUrlInput, setProofUrlInput] = useState("");
  const [proofMake, setProofMake] = useState("");
  const [proofModel, setProofModel] = useState("");
  const [proofYear, setProofYear] = useState("");
  const [proofFinish, setProofFinish] = useState<PanelJob["finish"]>("Gloss");
  const [proofCategory, setProofCategory] = useState<"restyle" | "commercial">("commercial");
  const [proofRunning, setProofRunning] = useState(false);
  const [proofStatus, setProofStatus] = useState("");
  const [proofResult, setProofResult] = useState<ProofResult | null>(null);
  const proofFileRef = useRef<HTMLInputElement>(null);

  // Build Production Pack (Proof → Artboard → true-size CMYK panel pack)
  const [packRunning, setPackRunning] = useState(false);
  const [packResult, setPackResult] = useState<{ orderNumber: string; jobId: string } | null>(null);

  const handleProofFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProofFile(file);
    setProofUrlInput("");
    const reader = new FileReader();
    reader.onload = () => setProofPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const clearProof = () => {
    setProofFile(null);
    setProofPreview(null);
    setProofUrlInput("");
    setProofResult(null);
    setProofStatus("");
    if (proofFileRef.current) proofFileRef.current.value = "";
  };

  const runProofArtboard = async () => {
    toast.message("Artboard generation moved to the sanctioned pipeline", {
      description:
        "Build panels from RevisionStudio (Production Layers → Build print panels) or the Design Assets page — they land on the PanelPro Studio Board for QC.",
    });
  };

  /* ── Build Production Pack from the Proof → Artboard result ─────────────
       Joins each faithful per-side flat panel with its REAL dimensions, then
       hands them to the canonical deterministic slicer (proof-pack-from-artboard
       → process-production-pack): true-size CMYK TIFF panels + 2" bleed + QC
       certificate + ZIP → the customer's WrapBox. Same engine as the paid pack. */
  const sideOfPanelKey = (panelKey: string, label: string): string | null => {
    const s = `${panelKey} ${label}`.toLowerCase();
    if (s.includes("driver")) return "driver";
    if (s.includes("passenger")) return "passenger";
    if (s.includes("hood")) return "hood";
    if (s.includes("roof") || s.includes("top")) return "roof";
    if (s.includes("front")) return "front";
    if (s.includes("rear") || s.includes("trunk") || s.includes("tailgate")) return "rear";
    return null;
  };

  const runBuildPack = async () => {
    if (!proofResult) return;
    // Join each rendered side panel with its real dimensions from the validated
    // panel list (matched by side). Only sides that actually flattened are sent.
    const sidePanels = proofResult.sidePanels
      .filter((sp) => !!sp.panelUrl)
      .map((sp) => {
        const dims = proofResult.panels.find(
          (p) => sideOfPanelKey(p.panelKey, p.label) === sp.side,
        );
        return {
          side: sp.side,
          label: sp.label,
          url: sp.panelUrl as string,
          widthInches: dims?.widthInches ?? null,
          heightInches: dims?.heightInches ?? null,
        };
      });

    if (sidePanels.length === 0) {
      toast.error("No flattened side panels to build a pack from");
      return;
    }

    setPackRunning(true);
    setPackResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("proof-pack-from-artboard", {
        body: {
          side_panels: sidePanels,
          artboardUrl: proofResult.artboardUrl,
          vehicleMake: proofMake.trim(),
          vehicleModel: proofModel.trim(),
          vehicleYear: proofYear.trim() ? Number(proofYear.trim()) : null,
          vehicleName: proofResult.vehicleName,
          finish: proofFinish,
          totalSqFt: proofResult.totalSqFt,
          dimsVerified: proofResult.dimsVerified,
        },
      });

      if (error) {
        const detail = (data as any)?.error || error.message;
        throw new Error(detail || "Pack build failed");
      }
      if (!(data as any)?.ok || !(data as any)?.order_number) {
        throw new Error((data as any)?.error || "No order number returned");
      }

      setPackResult({
        orderNumber: (data as any).order_number,
        jobId: (data as any).job_id,
      });
      toast.success(
        `Production pack building — order ${(data as any).order_number}. Track it in Print Production / QC.`,
      );
    } catch (err: any) {
      toast.error(err.message || "Pack build failed");
    } finally {
      setPackRunning(false);
    }
  };

  const EDIT_PRESETS = [
    "Make this a fully flat 2D panel — remove any 3D vehicle, perspective, or curvature. Front-on orthographic view only.",
    "Extend the artwork edge-to-edge with a 2 inch bleed all around. No white border, no margin, no empty space anywhere.",
    "Remove any vehicle body, wheels, windows, or background scene. The artwork should fill the entire canvas as a flat printable strip.",
    "Remove any text, logos, dimension labels, captions, or watermarks. Keep only the design artwork.",
  ];

  /* ── Gallery query — reads from designpanelpro_patterns ────────── */
  const { data: galleryPanels = [], isLoading: galleryLoading } = useQuery({
    queryKey: ["panel-gallery"],
    queryFn: async () => {
      const { data, error } = await db
        .from("designpanelpro_patterns")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as GalleryPanel[];
    },
  });

  /* ── Derived batch history (grouped by date since no batch_id col) */
  const batchHistory = (() => {
    const batches: Record<string, {
      date_key: string;
      count: number;
      created_at: string;
      categories: string[];
      activeCount: number;
      curatedCount: number;
    }> = {};

    for (const d of galleryPanels) {
      if (!d.created_at) continue;
      const dateKey = new Date(d.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      if (!batches[dateKey]) {
        batches[dateKey] = {
          date_key: dateKey,
          count: 0,
          created_at: d.created_at,
          categories: [],
          activeCount: 0,
          curatedCount: 0,
        };
      }
      batches[dateKey].count++;
      if (d.is_active) batches[dateKey].activeCount++;
      if (d.is_curated) batches[dateKey].curatedCount++;
      if (d.category && !batches[dateKey].categories.includes(d.category)) {
        batches[dateKey].categories.push(d.category);
      }
    }

    return Object.values(batches).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  })();

  /* ── Build queue ──────────────────────────────────────────────── */
  const buildBatch = useCallback(() => {
    const prompts = getRandomPresets(batchSize, category);
    const newJobs: PanelJob[] = prompts.map((prompt, i) => ({
      id: `fp_${Date.now()}_${i}`,
      prompt,
      finish: FINISHES[i % FINISHES.length],
      status: "queued",
      panelUrl: null,
      designName: null,
      patternId: null,
      error: null,
      startedAt: null,
      durationMs: null,
    }));
    setJobs(newJobs);
    setCompletedCount(0);
    shouldStopRef.current = false;
    setRatings({});
    toast.success(`${newJobs.length} flat panel jobs queued`);
  }, [batchSize, category]);

  // Fire artboard generation for a single panel (non-blocking)
  const fireArtboard = (panelUrl: string, designName: string, jobId: string) => {
    supabase.functions.invoke("generate-artboard-flat", {
      body: {
        job_id: `panel-${jobId}`,
        vehicle_name: `${designName} — ${category}`,
        approved_render_url: panelUrl,
        allRenderUrls: [panelUrl],
      },
    }).then(({ data }) => {
      if (data?.artboard_url) {
        console.log(`[PanelBatch] Artboard ready for "${designName}"`);
      }
    }).catch(err => {
      console.warn(`[PanelBatch] Artboard failed for "${designName}" (non-critical):`, err);
    });
  };

  /* ── Run one job ──────────────────────────────────────────────── */
  const runOne = async (job: PanelJob): Promise<Partial<PanelJob>> => {
    const t0 = Date.now();
    try {
      const { data, error } = await supabase.functions.invoke("generate-flat-panel", {
        body: {
          prompt: job.prompt.prompt,
          category: job.prompt.category,
          finish: job.finish,
        },
      });

      if (error) {
        const detail = data?.error || error.message;
        throw new Error(detail || "Generation failed");
      }

      if (!data?.panelUrl) throw new Error("No panel returned");

      fireArtboard(data.panelUrl, data.designName || "Panel", job.id);

      return {
        status: "done",
        panelUrl: data.panelUrl,
        designName: data.designName || null,
        patternId: data.patternId || null,
        durationMs: Date.now() - t0,
      };
    } catch (err: any) {
      return {
        status: "failed",
        error: err.message || "Unknown error",
        durationMs: Date.now() - t0,
      };
    }
  };

  /* ── Run batch ────────────────────────────────────────────────── */
  const runBatch = async () => {
    setIsRunning(true);
    shouldStopRef.current = false;
    setCompletedCount(0);

    for (let i = 0; i < jobs.length; i++) {
      if (shouldStopRef.current) break;
      const job = jobs[i];
      if (job.status === "done") {
        setCompletedCount(c => c + 1);
        continue;
      }

      setJobs(prev => prev.map((j, idx) => idx === i ? { ...j, status: "running", startedAt: Date.now() } : j));
      const result = await runOne(job);
      setJobs(prev => prev.map((j, idx) => idx === i ? { ...j, ...result } : j));
      setCompletedCount(c => c + 1);

      if (result.status === "done") {
        toast.success(`Panel ${i + 1}/${jobs.length} complete`);
      } else {
        toast.error(`Panel ${i + 1} failed: ${result.error}`);
      }

      if (i < jobs.length - 1 && !shouldStopRef.current) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    setIsRunning(false);
    queryClient.invalidateQueries({ queryKey: ["panel-gallery"] });
    toast.success("Batch complete! Artboards generating in background.");
  };

  const stopBatch = () => {
    shouldStopRef.current = true;
    toast.info("Stopping after current job...");
  };

  /* ── Delete panel from DB + storage + local state ─────────────── */
  const deletePanel = async (job: PanelJob) => {
    try {
      if (job.patternId) {
        const { error } = await supabase
          .from("designpanelpro_patterns")
          .delete()
          .eq("id", job.patternId);
        if (error) console.warn("DB delete error:", error.message);
      }
      if (job.panelUrl) {
        const match = job.panelUrl.match(/wrap-files\/(.+?)(\?|$)/);
        if (match) await supabase.storage.from("wrap-files").remove([match[1]]);
      }
      setJobs(prev => prev.filter(j => j.id !== job.id));
      queryClient.invalidateQueries({ queryKey: ["panel-gallery"] });
      toast.success(`"${job.designName || 'Panel'}" deleted from library`);
    } catch (err: any) {
      toast.error("Delete failed: " + (err.message || "Unknown error"));
    }
  };

  /* ── Regenerate single ────────────────────────────────────────── */
  const regeneratePanel = async (jobIndex: number) => {
    const job = jobs[jobIndex];
    if (!job) return;
    if (job.patternId) {
      await supabase.from("designpanelpro_patterns").delete().eq("id", job.patternId);
    }
    if (job.panelUrl) {
      const match = job.panelUrl.match(/wrap-files\/(.+?)(\?|$)/);
      if (match) await supabase.storage.from("wrap-files").remove([match[1]]);
    }
    setJobs(prev => prev.map((j, idx) =>
      idx === jobIndex
        ? { ...j, status: "running" as const, startedAt: Date.now(), panelUrl: null, designName: null, patternId: null, error: null }
        : j
    ));
    const result = await runOne({ ...job, status: "queued" });
    setJobs(prev => prev.map((j, idx) => idx === jobIndex ? { ...j, ...result } : j));
    queryClient.invalidateQueries({ queryKey: ["panel-gallery"] });
    if (result.status === "done") toast.success(`"${result.designName || "Panel"}" regenerated`);
    else toast.error(`Regeneration failed: ${result.error}`);
  };

  /* ── Edit & Redo via Gemini ───────────────────────────────────── */
  const openEditDialog = (target: {
    imageUrl: string;
    patternId: string | null;
    name: string;
    finish?: PanelJob["finish"];
    jobIndex?: number;
    galleryId?: string;
  }) => {
    setEditTarget(target);
    setEditInstruction("");
  };

  const submitEdit = async () => {
    if (!editTarget || !editInstruction.trim()) {
      toast.error("Describe the edit you want before submitting");
      return;
    }
    setEditSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("edit-flat-panel", {
        body: {
          imageUrl: editTarget.imageUrl,
          editInstruction: editInstruction.trim(),
          patternId: editTarget.patternId,
          finish: editTarget.finish || "Gloss",
        },
      });

      if (error) {
        const detail = (data as any)?.error || error.message;
        throw new Error(detail || "Edit failed");
      }
      const newUrl = (data as any)?.panelUrl;
      if (!newUrl) throw new Error("No panel returned");

      // Update local job state if this came from the queue
      if (typeof editTarget.jobIndex === "number") {
        const idx = editTarget.jobIndex;
        setJobs(prev => prev.map((j, i) => i === idx ? { ...j, panelUrl: newUrl } : j));
      }

      // Refresh gallery
      queryClient.invalidateQueries({ queryKey: ["panel-gallery"] });

      toast.success(`"${editTarget.name}" edited`);
      setEditTarget(null);
      setEditInstruction("");
    } catch (err: any) {
      toast.error(`Edit failed: ${err.message || "Unknown error"}`);
    } finally {
      setEditSubmitting(false);
    }
  };

  const clearAll = () => { setJobs([]); setCompletedCount(0); setRatings({}); };

  const retryFailed = () => {
    setJobs(prev => prev.map(j => j.status === "failed" ? { ...j, status: "queued", error: null } : j));
    toast.info("Failed jobs re-queued");
  };

  /* ── Gallery management ───────────────────────────────────────── */
  const toggleGalleryActive = async (id: string, active: boolean) => {
    const { error } = await db.from("designpanelpro_patterns").update({ is_active: active }).eq("id", id);
    if (error) { toast.error("Update failed"); return; }
    queryClient.invalidateQueries({ queryKey: ["panel-gallery"] });
    toast.success(active ? "Panel activated" : "Panel hidden");
  };

  const deleteFromGallery = async (panel: GalleryPanel) => {
    if (panel.media_url) {
      const match = panel.media_url.match(/wrap-files\/(.+?)(\?|$)/);
      if (match) await supabase.storage.from("wrap-files").remove([match[1]]);
    }
    const { error } = await db.from("designpanelpro_patterns").delete().eq("id", panel.id);
    if (error) { toast.error("Delete failed"); return; }
    queryClient.invalidateQueries({ queryKey: ["panel-gallery"] });
    toast.success(`"${panel.name}" removed`);
  };

  const regenerateGalleryPanel = async (panel: GalleryPanel) => {
    const panelCategory = (panel.category === "commercial" ? "commercial" : "restyle") as "restyle" | "commercial";

    // Prefer the original prompt + finish stored on the panel; fall back to a
    // random preset for legacy panels generated before those columns existed.
    let promptText = panel.prompt_text?.trim() || "";
    let finish: PanelJob["finish"] = (FINISHES.includes(panel.finish as any) ? panel.finish : "Gloss") as PanelJob["finish"];

    if (!promptText) {
      const [preset] = getRandomPresets(1, panelCategory);
      if (!preset) {
        toast.error("No prompt preset available for this category");
        return;
      }
      promptText = preset.prompt;
    }

    setRegeneratingId(panel.id);
    try {
      const { data, error } = await supabase.functions.invoke("generate-flat-panel", {
        body: {
          prompt: promptText,
          category: panelCategory,
          finish,
        },
      });

      if (error) {
        const detail = (data as any)?.error || error.message;
        throw new Error(detail || "Generation failed");
      }
      if (!data?.panelUrl) throw new Error("No panel returned");

      if (panel.media_url) {
        const match = panel.media_url.match(/wrap-files\/(.+?)(\?|$)/);
        if (match) await supabase.storage.from("wrap-files").remove([match[1]]);
      }
      const { error: delErr } = await db.from("designpanelpro_patterns").delete().eq("id", panel.id);
      if (delErr) console.warn("Old pattern delete error:", delErr.message);

      fireArtboard(data.panelUrl, data.designName || panel.name, panel.id);

      queryClient.invalidateQueries({ queryKey: ["panel-gallery"] });
      toast.success(`"${data.designName || panel.name}" regenerated`);
    } catch (err: any) {
      toast.error(`Regeneration failed: ${err.message || "Unknown error"}`);
    } finally {
      setRegeneratingId(null);
    }
  };

  const saveDesignName = async (id: string) => {
    if (!editName.trim()) return;
    const { error } = await db.from("designpanelpro_patterns").update({ name: editName.trim() }).eq("id", id);
    if (error) { toast.error("Update failed"); return; }
    setEditingId(null);
    queryClient.invalidateQueries({ queryKey: ["panel-gallery"] });
    toast.success("Name updated");
  };

  /* ── Computed ─────────────────────────────────────────────────── */
  const doneCount = jobs.filter(j => j.status === "done").length;
  const failedCount = jobs.filter(j => j.status === "failed").length;
  const progress = jobs.length > 0 ? (completedCount / jobs.length) * 100 : 0;

  const filteredGallery = galleryFilter === "all"
    ? galleryPanels
    : galleryPanels.filter(d => d.category === galleryFilter);
  const galleryCategories = [...new Set(galleryPanels.map(d => d.category).filter(Boolean))].sort() as string[];
  const activeGalleryCount = galleryPanels.filter(d => d.is_active).length;

  const getImageUrl = (panel: GalleryPanel) => panel.thumbnail_url || panel.media_url;

  /* ── Render ───────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-background p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="h-6 w-6 text-purple-400" />
            DesignPanel Batch Generate
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generate flat panel artwork for RestyleLibrary — panels auto-publish on generation.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><ImageIcon className="h-3.5 w-3.5" /> {galleryPanels.length} total</span>
          <span className="flex items-center gap-1 text-green-400"><Eye className="h-3.5 w-3.5" /> {activeGalleryCount} active</span>
          <span className="flex items-center gap-1 text-zinc-500"><History className="h-3.5 w-3.5" /> {batchHistory.length} batches</span>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="proof" className="space-y-4">
        <TabsList className="grid w-full max-w-2xl grid-cols-6">
          <TabsTrigger value="proof" className="gap-1.5">
            <LayoutGrid className="h-3.5 w-3.5" /> Proof → Artboard
          </TabsTrigger>
          <TabsTrigger value="upload" className="gap-1.5">
            <Upload className="h-3.5 w-3.5" /> Upload
          </TabsTrigger>
          <TabsTrigger value="side" className="gap-1.5">
            <Wand2 className="h-3.5 w-3.5" /> Side
          </TabsTrigger>
          <TabsTrigger value="generator" className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> Batch
          </TabsTrigger>
          <TabsTrigger value="gallery" className="gap-1.5">
            <LayoutGrid className="h-3.5 w-3.5" /> Gallery ({galleryPanels.length})
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="h-3.5 w-3.5" /> History ({batchHistory.length})
          </TabsTrigger>
        </TabsList>

        {/* ============================================================ */}
        {/* TAB: PROOF → MULTI-PANEL ARTBOARD                            */}
        {/*                                                              */}
        {/* Upload ONE flat 2D production proof (multi-view approval     */}
        {/* sheet) + vehicle make/model/year → one dimensioned          */}
        {/* multi-panel flat artboard. Faithful (image-anchored), not   */}
        {/* text-to-image — reproduces the approved design, no slop.    */}
        {/* ============================================================ */}
        <TabsContent value="proof" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: inputs */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <LayoutGrid className="h-4 w-4 text-cyan-400" />
                  2D Proof → Flat Panel Artboard
                </CardTitle>
                <CardDescription>
                  Upload the multi-view production proof and enter the vehicle. We size every panel
                  from the real vehicle dimensions, faithfully flatten each side off the proof, and
                  compose one dimensioned artboard. The approved artwork is reproduced — not redesigned.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Proof upload */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Production Proof (multi-view sheet)</Label>
                  <div
                    className={cn(
                      "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
                      proofPreview ? "border-cyan-500/50 bg-cyan-500/5" : "border-zinc-700 hover:border-zinc-500",
                    )}
                    onClick={() => proofFileRef.current?.click()}
                  >
                    {proofPreview ? (
                      <img src={proofPreview} alt="Proof preview" className="max-h-56 mx-auto rounded-md object-contain" />
                    ) : (
                      <div className="space-y-2">
                        <Upload className="h-8 w-8 text-muted-foreground mx-auto" />
                        <p className="text-sm text-muted-foreground">Click to upload the 2D proof sheet</p>
                        <p className="text-[10px] text-muted-foreground">PNG, JPG up to 10MB</p>
                      </div>
                    )}
                  </div>
                  <input
                    ref={proofFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={handleProofFileChange}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Or paste a proof URL</Label>
                  <Input
                    value={proofUrlInput}
                    onChange={(e) => {
                      setProofUrlInput(e.target.value);
                      if (e.target.value.trim()) {
                        setProofFile(null);
                        setProofPreview(e.target.value.trim());
                      }
                    }}
                    placeholder="https://..."
                    className="text-sm"
                    disabled={proofRunning}
                  />
                </div>

                {/* Vehicle dims */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Make</Label>
                    <Input value={proofMake} onChange={(e) => setProofMake(e.target.value)} placeholder="Cadillac" className="text-sm" disabled={proofRunning} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Model</Label>
                    <Input value={proofModel} onChange={(e) => setProofModel(e.target.value)} placeholder="Escalade ESV" className="text-sm" disabled={proofRunning} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Year</Label>
                    <Input value={proofYear} onChange={(e) => setProofYear(e.target.value)} placeholder="2022" className="text-sm" disabled={proofRunning} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Category</Label>
                    <Select value={proofCategory} onValueChange={(v: any) => setProofCategory(v)} disabled={proofRunning}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="commercial">Commercial (branded)</SelectItem>
                        <SelectItem value="restyle">Restyle (art)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Finish</Label>
                    <Select value={proofFinish} onValueChange={(v: any) => setProofFinish(v)} disabled={proofRunning}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {FINISHES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={runProofArtboard}
                    disabled={proofRunning || (!proofFile && !proofUrlInput.trim())}
                    className="gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white flex-1"
                  >
                    {proofRunning ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
                    ) : (
                      <><LayoutGrid className="h-4 w-4" /> Generate Artboard</>
                    )}
                  </Button>
                  {(proofFile || proofUrlInput || proofResult) && (
                    <Button onClick={clearProof} variant="ghost" size="sm" className="text-xs text-muted-foreground" disabled={proofRunning}>
                      Clear
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Right: result */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Artboard</CardTitle>
                <CardDescription>Dimensioned multi-panel flat artboard + per-panel downloads</CardDescription>
              </CardHeader>
              <CardContent>
                {proofRunning ? (
                  <div className="aspect-video bg-secondary/30 rounded-lg flex items-center justify-center">
                    <div className="text-center px-4">
                      <Loader2 className="h-10 w-10 text-cyan-400 animate-spin mx-auto mb-2" />
                      <p className="text-sm text-cyan-400">{proofStatus || "Generating…"}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">Each side is faithfully flattened off your proof, then composed</p>
                    </div>
                  </div>
                ) : proofResult ? (
                  <div className="space-y-3">
                    <div className="rounded-lg overflow-hidden border bg-white">
                      <img src={proofResult.artboardUrl} alt="Artboard" className="w-full object-contain" />
                    </div>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <p className="text-sm font-semibold">{proofResult.vehicleName}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {proofResult.panels.length} panels · {proofResult.totalSqFt || "?"} sq ft ·{" "}
                          {proofResult.dimsVerified
                            ? <span className="text-green-400">dims verified</span>
                            : <span className="text-yellow-400">dims estimated — verify before print</span>}
                        </p>
                      </div>
                      <Button
                        variant="outline" size="sm" className="gap-1 text-xs"
                        onClick={() => downloadImage(proofResult.artboardUrl, `${proofResult.vehicleName}-artboard`)}
                      >
                        <Download className="h-3 w-3" /> Download Artboard
                      </Button>
                    </div>

                    {proofResult.failedSides?.length > 0 && (
                      <p className="text-[11px] text-yellow-400">
                        Could not flatten: {proofResult.failedSides.join(", ")} — re-run or upload a clearer proof.
                      </p>
                    )}

                    {/* Build Production Pack — true-size CMYK panels + 2" bleed + QC + ZIP */}
                    <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <p className="text-xs font-semibold">Print Production Pack</p>
                          <p className="text-[10px] text-muted-foreground">
                            True-size CMYK panels · 2" bleed · QC certificate · ZIP → WrapBox
                          </p>
                        </div>
                        <Button
                          size="sm"
                          className="gap-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 text-white text-xs"
                          onClick={runBuildPack}
                          disabled={packRunning || !proofResult.sidePanels.some((sp) => sp.panelUrl)}
                        >
                          {packRunning ? (
                            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Building…</>
                          ) : (
                            <><Layers className="h-3.5 w-3.5" /> Build Production Pack</>
                          )}
                        </Button>
                      </div>
                      {packResult && (
                        <p className="text-[11px] text-green-400">
                          Pack building — order <span className="font-mono">{packResult.orderNumber}</span>.
                          Track it in Print Production / QC (panels finalize there).
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground">
                        Color is device-CMYK (no press ICC profile yet) and large sides ship at the
                        max achievable DPI — both are recorded honestly in the pack manifest + filenames.
                      </p>
                    </div>

                    {/* Per-side flat panels */}
                    <div>
                      <Label className="text-xs text-muted-foreground">Individual flat panels</Label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1.5">
                        {proofResult.sidePanels.filter(sp => sp.panelUrl).map((sp) => (
                          <div key={sp.side} className="rounded-md overflow-hidden border bg-white">
                            <img src={sp.panelUrl!} alt={sp.label} className="w-full aspect-video object-cover" loading="lazy" />
                            <div className="flex items-center justify-between px-2 py-1">
                              <span className="text-[10px] font-medium truncate">{sp.label}</span>
                              <button
                                className="text-[10px] text-blue-400 hover:text-blue-300"
                                onClick={() => downloadImage(sp.panelUrl!, `${proofResult.vehicleName}-${sp.side}`)}
                              >
                                <Download className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="aspect-video bg-secondary/30 rounded-lg flex items-center justify-center">
                    <div className="text-center px-4">
                      <LayoutGrid className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">Upload a 2D proof + vehicle to build the artboard</p>
                      <p className="text-[10px] text-muted-foreground mt-1">Reproduces the approved design faithfully — no AI redesign</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ============================================================ */}
        {/* TAB 0: SINGLE UPLOAD                                         */}
        {/* ============================================================ */}
        <TabsContent value="upload" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Upload + Settings */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Upload className="h-4 w-4 text-cyan-400" />
                  Upload a Render
                </CardTitle>
                <CardDescription>Upload a 3D render image and generate a flat panel from it</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* File upload */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Render Image</Label>
                  <div
                    className={cn(
                      "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
                      singlePreview ? "border-cyan-500/50 bg-cyan-500/5" : "border-zinc-700 hover:border-zinc-500",
                    )}
                    onClick={() => singleFileRef.current?.click()}
                  >
                    {singlePreview ? (
                      <img src={singlePreview} alt="Preview" className="max-h-48 mx-auto rounded-md object-contain" />
                    ) : (
                      <div className="space-y-2">
                        <Upload className="h-8 w-8 text-muted-foreground mx-auto" />
                        <p className="text-sm text-muted-foreground">Click to upload a render image</p>
                        <p className="text-[10px] text-muted-foreground">PNG, JPG up to 10MB</p>
                      </div>
                    )}
                  </div>
                  <input
                    ref={singleFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={handleSingleFileChange}
                  />
                </div>

                {/* OR paste URL */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Or paste a render URL</Label>
                  <Input
                    value={singleUrl}
                    onChange={(e) => {
                      setSingleUrl(e.target.value);
                      if (e.target.value.trim()) {
                        setSingleFile(null);
                        setSinglePreview(e.target.value.trim());
                      }
                    }}
                    placeholder="https://..."
                    className="text-sm"
                    disabled={singleRunning}
                  />
                </div>

                {/* Design name */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Design Name (optional)</Label>
                  <Input
                    value={singleName}
                    onChange={(e) => setSingleName(e.target.value)}
                    placeholder="e.g. Electric Storm Side Panel"
                    className="text-sm"
                    disabled={singleRunning}
                  />
                </div>

                {/* Category + Finish */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Category</Label>
                    <Select value={singleCategory} onValueChange={(v: any) => setSingleCategory(v)} disabled={singleRunning}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="restyle">Restyle</SelectItem>
                        <SelectItem value="commercial">Commercial</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Finish</Label>
                    <Select value={singleFinish} onValueChange={(v: any) => setSingleFinish(v)} disabled={singleRunning}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {FINISHES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={runSingleGenerate}
                    disabled={singleRunning || (!singleFile && !singleUrl.trim())}
                    className="gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white flex-1"
                  >
                    {singleRunning ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Generating...</>
                    ) : (
                      <><Zap className="h-4 w-4" /> Generate Flat Panel</>
                    )}
                  </Button>
                  {(singleFile || singleUrl || singleResult) && (
                    <Button onClick={clearSingleUpload} variant="ghost" size="sm" className="text-xs text-muted-foreground" disabled={singleRunning}>
                      Clear
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Right: Result */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Result</CardTitle>
                <CardDescription>Generated flat panel will appear here</CardDescription>
              </CardHeader>
              <CardContent>
                {singleRunning ? (
                  <div className="aspect-video bg-secondary/30 rounded-lg flex items-center justify-center">
                    <div className="text-center">
                      <Loader2 className="h-10 w-10 text-cyan-400 animate-spin mx-auto mb-2" />
                      <p className="text-sm text-cyan-400">Generating flat panel from render...</p>
                      <p className="text-[10px] text-muted-foreground mt-1">This may take 30-60 seconds</p>
                    </div>
                  </div>
                ) : singleResult ? (
                  <div className="space-y-3">
                    <div className="rounded-lg overflow-hidden border bg-secondary/30">
                      <img src={singleResult.panelUrl} alt={singleResult.designName} className="w-full aspect-video object-cover" />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold">{singleResult.designName}</p>
                        <p className="text-[10px] text-muted-foreground">{singleCategory} · {singleFinish}</p>
                      </div>
                      <Badge className="bg-green-600 text-[10px]">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Published
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline" size="sm" className="gap-1 text-xs"
                        onClick={() => downloadImage(singleResult.panelUrl, singleResult.designName)}
                      >
                        <Download className="h-3 w-3" /> Download
                      </Button>
                      <Button
                        variant="outline" size="sm" className="gap-1 text-xs text-purple-400 hover:text-purple-300"
                        onClick={() => openEditDialog({
                          imageUrl: singleResult.panelUrl,
                          patternId: null,
                          name: singleResult.designName,
                          finish: singleFinish,
                        })}
                      >
                        <Wand2 className="h-3 w-3" /> Edit
                      </Button>
                      <Button
                        variant="outline" size="sm" className="gap-1 text-xs"
                        onClick={() => { clearSingleUpload(); }}
                      >
                        <RefreshCw className="h-3 w-3" /> New
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="aspect-video bg-secondary/30 rounded-lg flex items-center justify-center">
                    <div className="text-center">
                      <ImageIcon className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">Upload a render to get started</p>
                      <p className="text-[10px] text-muted-foreground mt-1">The render will be converted to a flat, print-ready panel</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ============================================================ */}
        {/* TAB 0b: SIDE PANEL (mobile-friendly, per-side picker)        */}
        {/*                                                              */}
        {/* Mirrors the Upload tab but lets you pick which side this is  */}
        {/* (Driver / Passenger / Hood / Roof / Rear / Front / Full      */}
        {/* Wrap) and passes that through to the edge function. Lives    */}
        {/* alongside the original Upload tab so existing workflows are  */}
        {/* untouched. Single-column layout works on phones.             */}
        {/* ============================================================ */}
        <TabsContent value="side" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Wand2 className="h-4 w-4 text-cyan-400" />
                Single Side Panel
              </CardTitle>
              <CardDescription>
                Upload a render or 2D production proof and pick which side this is. Output is a print-ready ~6K PNG (gpt-image-1 → Real-ESRGAN 4x).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Render Image</Label>
                <div
                  className={cn(
                    "border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors",
                    sidePreview ? "border-cyan-500/50 bg-cyan-500/5" : "border-zinc-700 hover:border-zinc-500",
                  )}
                  onClick={() => sideFileRef.current?.click()}
                >
                  {sidePreview ? (
                    <img src={sidePreview} alt="Preview" className="max-h-48 mx-auto rounded-md object-contain" />
                  ) : (
                    <div className="space-y-1">
                      <Upload className="h-7 w-7 text-muted-foreground mx-auto" />
                      <p className="text-xs text-muted-foreground">Tap to upload a render image</p>
                      <p className="text-[10px] text-muted-foreground">PNG, JPG up to 10MB</p>
                    </div>
                  )}
                </div>
                <input
                  ref={sideFileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleSidePanelFileChange}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Or paste a render URL</Label>
                <Input
                  value={sideUrl}
                  onChange={(e) => {
                    setSideUrl(e.target.value);
                    if (e.target.value.trim()) {
                      setSideFile(null);
                      setSidePreview(e.target.value.trim());
                    }
                  }}
                  placeholder="https://..."
                  className="text-sm"
                  disabled={sideRunning}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Which side is this?</Label>
                <Select value={sideKey} onValueChange={(v: any) => setSideKey(v)} disabled={sideRunning}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SIDE_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  Picking the actual side keeps the reproduction faithful — generic "full_wrap" causes drift on rear/hood/roof.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Design Name (optional)</Label>
                <Input
                  value={sideName}
                  onChange={(e) => setSideName(e.target.value)}
                  placeholder="e.g. American Flag Driver Side"
                  className="text-sm"
                  disabled={sideRunning}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Category</Label>
                  <Select value={sideCategory} onValueChange={(v: any) => setSideCategory(v)} disabled={sideRunning}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="restyle">Restyle</SelectItem>
                      <SelectItem value="commercial">Commercial</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Finish</Label>
                  <Select value={sideFinish} onValueChange={(v: any) => setSideFinish(v)} disabled={sideRunning}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FINISHES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  onClick={runSideGenerate}
                  disabled={sideRunning || (!sideFile && !sideUrl.trim())}
                  className="gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white flex-1 h-11"
                >
                  {sideRunning ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Generating...</>
                  ) : (
                    <><Zap className="h-4 w-4" /> Generate Flat Panel</>
                  )}
                </Button>
                {(sideFile || sideUrl || sideResult) && (
                  <Button onClick={clearSidePanel} variant="ghost" size="sm" className="text-xs text-muted-foreground h-11" disabled={sideRunning}>
                    Clear
                  </Button>
                )}
              </div>

              <div className="pt-2">
                <Label className="text-xs text-muted-foreground">Result</Label>
                <div className="mt-1.5">
                  {sideRunning ? (
                    <div className="aspect-[3/2] bg-secondary/30 rounded-lg flex items-center justify-center">
                      <div className="text-center px-4">
                        <Loader2 className="h-9 w-9 text-cyan-400 animate-spin mx-auto mb-2" />
                        <p className="text-sm text-cyan-400">Generating + upscaling print-ready panel...</p>
                        <p className="text-[10px] text-muted-foreground mt-1">60–90s · gpt-image-1 → Real-ESRGAN 4x</p>
                      </div>
                    </div>
                  ) : sideResult ? (
                    <div className="space-y-2">
                      <div className="rounded-lg overflow-hidden border bg-white">
                        <img src={sideResult.panelUrl} alt={sideResult.designName} className="w-full object-contain" />
                      </div>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold">{sideResult.designName}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {sideResult.side.replace(/_/g, " ")} · {sideCategory} · {sideFinish}
                          </p>
                        </div>
                        <Badge className="bg-green-600 text-[10px]">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Published
                        </Badge>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <Button
                          variant="outline" size="sm" className="gap-1 text-xs h-10"
                          onClick={() => downloadImage(sideResult.panelUrl, `${sideResult.designName}-${sideResult.side}`)}
                        >
                          <Download className="h-3.5 w-3.5" /> Download PNG
                        </Button>
                        <Button
                          variant="outline" size="sm" className="gap-1 text-xs h-10"
                          onClick={clearSidePanel}
                        >
                          <RefreshCw className="h-3.5 w-3.5" /> New Side
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="aspect-[3/2] bg-secondary/30 rounded-lg flex items-center justify-center">
                      <div className="text-center px-4">
                        <ImageIcon className="h-9 w-9 text-muted-foreground/30 mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">Upload a render to get started</p>
                        <p className="text-[10px] text-muted-foreground mt-1">Output goes straight to the gallery, print-ready</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================================ */}
        {/* TAB 1: GENERATOR                                             */}
        {/* ============================================================ */}
        <TabsContent value="generator" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Batch Settings</CardTitle>
              <CardDescription>Configure and launch flat panel generation</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Category */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Category</Label>
                  <Select value={category} onValueChange={(v: any) => setCategory(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="restyle">Restyle (Abstract/Art)</SelectItem>
                      <SelectItem value="commercial">Commercial (Branded)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Batch Size */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Batch Size</Label>
                  <Select value={String(batchSize)} onValueChange={(v) => setBatchSize(Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[5, 10, 15, 20, 25].map(n => (
                        <SelectItem key={n} value={String(n)}>{n} panels</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Actions */}
                <div className="flex items-end gap-2">
                  <Button onClick={buildBatch} disabled={isRunning} variant="outline" className="gap-2">
                    <Zap className="h-4 w-4" /> Build Queue
                  </Button>
                  {jobs.length > 0 && !isRunning && (
                    <Button onClick={runBatch} className="gap-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white">
                      <Play className="h-4 w-4" /> Run
                    </Button>
                  )}
                  {isRunning && (
                    <Button onClick={stopBatch} variant="destructive" className="gap-2">
                      <Square className="h-4 w-4" /> Stop
                    </Button>
                  )}
                </div>
              </div>

              {/* Progress */}
              {jobs.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{completedCount}/{jobs.length} processed</span>
                    <span className="flex gap-3">
                      <span className="text-green-400">{doneCount} done</span>
                      {failedCount > 0 && <span className="text-red-400">{failedCount} failed</span>}
                    </span>
                  </div>
                  <Progress value={progress} className="h-2" />
                </div>
              )}

              {/* Secondary actions */}
              {jobs.length > 0 && !isRunning && (
                <div className="flex gap-2">
                  {failedCount > 0 && (
                    <Button onClick={retryFailed} variant="outline" size="sm" className="gap-1 text-xs">
                      <RefreshCw className="h-3 w-3" /> Retry Failed ({failedCount})
                    </Button>
                  )}
                  <Button onClick={clearAll} variant="ghost" size="sm" className="gap-1 text-xs text-muted-foreground">
                    <Trash2 className="h-3 w-3" /> Clear All
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Results Grid */}
          {jobs.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {jobs.map((job, idx) => (
                <Card key={job.id} className={cn(
                  "overflow-hidden transition-all",
                  job.status === "running" && "ring-2 ring-purple-500 animate-pulse",
                  job.status === "failed" && "border-red-500/50",
                )}>
                  {/* Image area */}
                  <div className="aspect-video bg-secondary/30 relative flex items-center justify-center overflow-hidden">
                    {job.status === "queued" && (
                      <div className="text-center">
                        <Clock className="h-6 w-6 text-muted-foreground mx-auto mb-1" />
                        <span className="text-xs text-muted-foreground">#{idx + 1} Queued</span>
                      </div>
                    )}
                    {job.status === "running" && (
                      <div className="text-center">
                        <Loader2 className="h-8 w-8 text-purple-400 animate-spin mx-auto mb-1" />
                        <span className="text-xs text-purple-400">Generating...</span>
                      </div>
                    )}
                    {job.status === "done" && job.panelUrl && (
                      <img src={job.panelUrl} alt={job.designName || "Panel"} className="w-full h-full object-cover" loading="lazy" />
                    )}
                    {job.status === "failed" && (
                      <div className="text-center px-3">
                        <XCircle className="h-6 w-6 text-red-400 mx-auto mb-1" />
                        <span className="text-xs text-red-400 line-clamp-2">{job.error}</span>
                      </div>
                    )}

                    {/* Status badge */}
                    <div className="absolute top-2 right-2">
                      {job.status === "done" && (
                        <Badge className="bg-green-600 text-[10px]">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          {((job.durationMs || 0) / 1000).toFixed(0)}s
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Info */}
                  <div className="p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">
                          {job.designName || job.prompt.name || "Panel Design"}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {job.prompt.subcategory} · {job.finish}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[9px] shrink-0">
                        {job.prompt.category}
                      </Badge>
                    </div>

                    <p className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed">
                      {job.prompt.prompt.substring(0, 120)}...
                    </p>

                    {/* Rating + Actions */}
                    {job.status === "done" && (
                      <div className="space-y-2">
                        <StarRating
                          value={ratings[job.id] || null}
                          onChange={(v) => setRatings(prev => ({ ...prev, [job.id]: v }))}
                        />
                        <div className="flex gap-1 flex-wrap">
                          {job.panelUrl && (
                            <Button
                              variant="ghost" size="sm"
                              className="h-7 px-2 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                              onClick={() => downloadImage(job.panelUrl!, job.designName || "panel-design")}
                            >
                              <Download className="h-3 w-3 mr-1" /> Save
                            </Button>
                          )}
                          <Button
                            variant="ghost" size="sm"
                            className="h-7 px-2 text-xs text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10"
                            onClick={() => regeneratePanel(idx)}
                            disabled={isRunning}
                          >
                            <RefreshCw className="h-3 w-3 mr-1" /> Regen
                          </Button>
                          {job.panelUrl && (
                            <Button
                              variant="ghost" size="sm"
                              className="h-7 px-2 text-xs text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
                              onClick={() => openEditDialog({
                                imageUrl: job.panelUrl!,
                                patternId: job.patternId,
                                name: job.designName || job.prompt.name || "Panel",
                                finish: job.finish,
                                jobIndex: idx,
                              })}
                              disabled={isRunning}
                            >
                              <Wand2 className="h-3 w-3 mr-1" /> Edit
                            </Button>
                          )}
                          <Button
                            variant="ghost" size="sm"
                            className="h-7 px-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            onClick={() => deletePanel(job)}
                          >
                            <Trash2 className="h-3 w-3 mr-1" /> Delete
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Empty state */}
          {jobs.length === 0 && (
            <Card className="p-12 text-center">
              <ImageIcon className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No panels queued</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Select a category and batch size, then click "Build Queue" to generate flat panels for RestyleLibrary.
              </p>
              <Button onClick={buildBatch} className="gap-2">
                <Zap className="h-4 w-4" /> Build Queue ({batchSize} {category} panels)
              </Button>
            </Card>
          )}
        </TabsContent>

        {/* ============================================================ */}
        {/* TAB 2: GALLERY MANAGER                                       */}
        {/* ============================================================ */}
        <TabsContent value="gallery" className="space-y-4">
          {/* Stats + Filter */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-muted-foreground">{galleryPanels.length} panels</span>
                  <span className="text-green-400">{activeGalleryCount} active</span>
                  <span className="text-zinc-500">{galleryPanels.length - activeGalleryCount} hidden</span>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Filter:</Label>
                  <Select value={galleryFilter} onValueChange={setGalleryFilter}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories ({galleryPanels.length})</SelectItem>
                      {galleryCategories.map(cat => (
                        <SelectItem key={cat} value={cat}>
                          {cat} ({galleryPanels.filter(d => d.category === cat).length})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Gallery Grid */}
          {galleryLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredGallery.length === 0 ? (
            <Card className="p-12 text-center">
              <LayoutGrid className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No panels in gallery</h3>
              <p className="text-sm text-muted-foreground">Generate panels from the Generator tab — they auto-publish here.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredGallery.map((panel) => (
                <Card key={panel.id} className={cn(
                  "overflow-hidden transition-all",
                  !panel.is_active && "opacity-50",
                )}>
                  {/* Image */}
                  <div className="aspect-video bg-secondary/30 relative overflow-hidden">
                    {getImageUrl(panel) ? (
                      <img src={getImageUrl(panel)!} alt={panel.name} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
                      </div>
                    )}

                    {/* Active badge */}
                    <div className="absolute top-2 right-2">
                      {panel.is_active ? (
                        <Badge className="bg-green-600 text-[10px]"><Eye className="h-3 w-3 mr-0.5" /> Active</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] bg-black/50"><EyeOff className="h-3 w-3 mr-0.5" /> Hidden</Badge>
                      )}
                    </div>

                    {/* Category badge */}
                    {panel.category && (
                      <div className="absolute top-2 left-2">
                        <Badge variant="outline" className="text-[9px] bg-black/50 backdrop-blur-sm">
                          {panel.category}
                        </Badge>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      {editingId === panel.id ? (
                        <div className="flex items-center gap-1 flex-1">
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="h-7 text-xs"
                            onKeyDown={(e) => e.key === "Enter" && saveDesignName(panel.id)}
                          />
                          <Button variant="ghost" size="sm" className="h-7 px-1.5" onClick={() => saveDesignName(panel.id)}>
                            <Save className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold truncate">{panel.name}</p>
                          {panel.ai_generated_name && panel.ai_generated_name !== panel.name && (
                            <p className="text-[10px] text-muted-foreground truncate">{panel.ai_generated_name}</p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Created date */}
                    {panel.created_at && (
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(panel.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                    )}

                    {/* Actions */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <Switch
                          checked={!!panel.is_active}
                          onCheckedChange={(v) => toggleGalleryActive(panel.id, v)}
                          className="scale-75"
                        />
                        <span className="text-[10px] text-muted-foreground">{panel.is_active ? "Active" : "Hidden"}</span>
                      </div>
                      <div className="flex gap-0.5">
                        {getImageUrl(panel) && (
                          <Button variant="ghost" size="sm" className="h-7 px-1.5 text-blue-400 hover:text-blue-300"
                            title="Download"
                            onClick={() => downloadImage(getImageUrl(panel)!, panel.name)}>
                            <Download className="h-3 w-3" />
                          </Button>
                        )}
                        {panel.media_url && (
                          <Button variant="ghost" size="sm" className="h-7 px-1.5 text-purple-400 hover:text-purple-300"
                            title="Edit & Redo with Gemini"
                            onClick={() => openEditDialog({
                              imageUrl: panel.media_url,
                              patternId: panel.id,
                              name: panel.name,
                              galleryId: panel.id,
                            })}>
                            <Wand2 className="h-3 w-3" />
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="h-7 px-1.5 text-cyan-400 hover:text-cyan-300"
                          title="Regenerate design"
                          disabled={regeneratingId === panel.id}
                          onClick={() => regenerateGalleryPanel(panel)}>
                          {regeneratingId === panel.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3" />
                          )}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-1.5 text-zinc-400 hover:text-zinc-300"
                          title="Rename"
                          onClick={() => { setEditingId(panel.id); setEditName(panel.name); }}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-1.5 text-red-400 hover:text-red-300"
                          title="Delete"
                          onClick={() => deleteFromGallery(panel)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ============================================================ */}
        {/* TAB 3: BATCH HISTORY                                         */}
        {/* ============================================================ */}
        <TabsContent value="history" className="space-y-4">
          {batchHistory.length === 0 ? (
            <Card className="p-12 text-center">
              <History className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No batch history</h3>
              <p className="text-sm text-muted-foreground">Generated panels will appear here grouped by date.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {batchHistory.map((batch) => (
                <Card key={batch.date_key} className="overflow-hidden">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">
                        {batch.date_key}
                      </CardTitle>
                      <Badge variant="outline" className="text-[10px]">
                        {batch.count} panels
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Categories */}
                    <div className="flex flex-wrap gap-1">
                      {batch.categories.map(cat => (
                        <Badge key={cat} variant="outline" className="text-[9px]">{cat}</Badge>
                      ))}
                    </div>

                    {/* Stats */}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Eye className="h-3 w-3 text-green-400" /> {batch.activeCount} active
                      </span>
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3 text-cyan-400" /> {batch.curatedCount} curated
                      </span>
                    </div>

                    {/* View in Gallery */}
                    <Button
                      variant="outline" size="sm"
                      className="w-full text-xs gap-1"
                      onClick={() => {
                        setGalleryFilter("all");
                      }}
                    >
                      <LayoutGrid className="h-3 w-3" /> View in Gallery
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ============================================================ */}
      {/* EDIT & REDO DIALOG (Gemini 3 Pro Image Edit)                 */}
      {/* ============================================================ */}
      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open && !editSubmitting) { setEditTarget(null); setEditInstruction(""); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-purple-400" />
              Edit &amp; Redo with Gemini
            </DialogTitle>
            <DialogDescription>
              Describe what should change. Gemini 3 Pro Image will edit this exact panel — keeping the design identity but applying your fix (e.g. "make it fully flat, edge-to-edge with 2&quot; bleed").
            </DialogDescription>
          </DialogHeader>

          {editTarget && (
            <div className="space-y-4">
              {/* Source preview */}
              <div className="rounded-lg overflow-hidden border bg-secondary/30">
                <img src={editTarget.imageUrl} alt={editTarget.name} className="w-full aspect-video object-cover" />
                <div className="p-2 text-xs text-muted-foreground">
                  Editing: <span className="font-semibold text-foreground">{editTarget.name}</span>
                </div>
              </div>

              {/* Quick presets */}
              <div className="space-y-2">
                <Label className="text-xs">Quick fixes (click to add)</Label>
                <div className="flex flex-wrap gap-1.5">
                  {EDIT_PRESETS.map((preset, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setEditInstruction(prev => prev ? `${prev}\n${preset}` : preset)}
                      className="text-[11px] px-2 py-1 rounded-md border border-purple-500/30 bg-purple-500/5 text-purple-300 hover:bg-purple-500/15 transition-colors text-left"
                      disabled={editSubmitting}
                    >
                      {preset.length > 70 ? preset.slice(0, 70) + "…" : preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Instruction */}
              <div className="space-y-1.5">
                <Label className="text-xs">Edit instruction</Label>
                <Textarea
                  value={editInstruction}
                  onChange={(e) => setEditInstruction(e.target.value)}
                  placeholder='e.g. "Make this a fully flat panel — no 3D vehicle. Extend artwork to all four edges with 2 inch bleed all around. No white border."'
                  rows={5}
                  className="text-sm resize-none"
                  disabled={editSubmitting}
                />
                <p className="text-[10px] text-muted-foreground">
                  Tip: be specific about the fix. Gemini will keep the rest of the design intact.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => { setEditTarget(null); setEditInstruction(""); }}
              disabled={editSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={submitEdit}
              disabled={editSubmitting || !editInstruction.trim()}
              className="gap-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white"
            >
              {editSubmitting ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Editing...</>
              ) : (
                <><Wand2 className="h-4 w-4" /> Edit &amp; Redo</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
