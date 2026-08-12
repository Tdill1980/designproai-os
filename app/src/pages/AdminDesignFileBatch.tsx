import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Zap, Play, Square, Loader2, XCircle, Star, RefreshCw,
  FileImage, CheckCircle2, Image as ImageIcon, Trash2, Download,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

/* ================================================================ */
/* Panel sides — one flat panel per vehicle area                    */
/* ================================================================ */

const PANEL_SIDES = [
  { key: "driver",    label: "Driver Side",    instruction: "Focus on the DRIVER SIDE (left side) of the vehicle. Reproduce only the wrap artwork visible on the driver-side doors, fender, and quarter panel as a flat panel." },
  { key: "passenger", label: "Passenger Side", instruction: "Focus on the PASSENGER SIDE (right side) of the vehicle. Reproduce only the wrap artwork visible on the passenger-side doors, fender, and quarter panel as a flat panel." },
  { key: "hood",      label: "Hood",           instruction: "Focus on the HOOD of the vehicle. Reproduce only the wrap artwork visible on the hood surface as a flat panel." },
  { key: "roof",      label: "Roof",           instruction: "Focus on the ROOF of the vehicle. Reproduce only the wrap artwork visible on the roof surface as a flat panel." },
  { key: "front",     label: "Front Bumper",   instruction: "Focus on the FRONT of the vehicle. Reproduce only the wrap artwork visible on the front bumper and grille surround as a flat panel." },
  { key: "rear",      label: "Rear / Tailgate", instruction: "Focus on the REAR of the vehicle. Reproduce only the wrap artwork visible on the rear bumper, tailgate, or trunk area as a flat panel." },
] as const;

type PanelKey = typeof PANEL_SIDES[number]["key"];

// True per-side aspect (W:H) — drives the deterministic crop from the Driver so
// each derived panel is the right shape. Only the Driver is AI-generated; every
// other side is a crop/mirror of it, so NO panel can ever contain a window.
const SIDE_ASPECT: Record<string, number> = {
  driver: 227 / 76, passenger: 227 / 76, hood: 62 / 46, roof: 60 / 81, front: 74 / 56, rear: 80 / 56,
};

// Regions (x,y,w,h as fractions) of the standard DesignProAI 2D Production Proof
// sheet — so we feed the flatten AI ONE side's view at a time instead of the
// whole multi-view sheet (which confused it into baking in windows/other views).
// Best-effort layout; adjustable if a proof template differs.
const PROOF_REGIONS: Record<string, [number, number, number, number]> = {
  driver:    [0.04, 0.15, 0.54, 0.42],
  passenger: [0.04, 0.57, 0.54, 0.42],
  roof:      [0.60, 0.16, 0.38, 0.40],
  hood:      [0.60, 0.16, 0.38, 0.40],
  front:     [0.55, 0.58, 0.22, 0.40],
  rear:      [0.76, 0.58, 0.22, 0.40],
};

interface PanelResult {
  key: PanelKey;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  panelUrl: string | null;
  designName: string | null;
  patternId: string | null;
  error: string | null;
  durationMs: number | null;
  startedAt: number | null;
}

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
/* Edge function error extractor                                    */
/* ================================================================ */
// supabase-js wraps non-2xx responses as FunctionsHttpError with the
// real body on error.context — without this, the user just sees the
// generic "Edge Function returned a non-2xx status code".
async function extractInvokeError(error: unknown, data: any): Promise<string> {
  if (data?.error) return data.error;
  const ctx = (error as any)?.context;
  if (ctx) {
    try {
      const body = await ctx.clone().json();
      if (body?.error) return body.error;
      if (typeof body === "string") return body;
    } catch {
      try {
        const text = await ctx.clone().text();
        if (text) return text;
      } catch { /* ignore */ }
    }
  }
  return (error as any)?.message || "";
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
    a.download = `${(name || "flat-panel").replace(/\s+/g, "-").toLowerCase()}.png`;
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

export default function AdminDesignFileBatch() {
  const queryClient = useQueryClient();

  /* ── Reference file state ─────────────────────────────────────── */
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referencePreview, setReferencePreview] = useState<string | null>(null);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [isUploadingReference, setIsUploadingReference] = useState(false);

  /* ── Settings ────────────────────────────────────────────────── */
  const [category, setCategory] = useState<"restyle" | "commercial">("restyle");
  const [finish, setFinish] = useState<"Gloss" | "Satin" | "Matte">("Gloss");
  const [userPrompt, setUserPrompt] = useState("");

  /* ── Panel set state ──────────────────────────────────────────── */
  const [panels, setPanels] = useState<PanelResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const shouldStopRef = useRef(false);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [reviseNotes, setReviseNotes] = useState<Record<string, string>>({});
  const [revisingPanel, setRevisingPanel] = useState<string | null>(null);

  /* ── Live ticker — drives elapsed-time displays ────────────────── */
  const [batchStartedAt, setBatchStartedAt] = useState<number | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    const anyRunning = isRunning || panels.some(p => p.status === "running") || revisingPanel !== null;
    if (!anyRunning) return;
    const iv = setInterval(() => setTick(t => t + 1), 500);
    return () => clearInterval(iv);
  }, [isRunning, panels, revisingPanel]);

  /* ── Auto-scroll to the panel that's currently running ─────────── */
  const runningCardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (runningCardRef.current) {
      runningCardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [panels.findIndex(p => p.status === "running")]);

  const fmtSecs = (ms: number) => `${(ms / 1000).toFixed(0)}s`;
  const liveElapsed = (startedAt: number | null) =>
    startedAt ? Math.max(0, Date.now() - startedAt) : 0;
  const runningIndex = panels.findIndex(p => p.status === "running");
  const runningPanel = runningIndex >= 0 ? panels[runningIndex] : null;

  /* ── Upload reference ─────────────────────────────────────────── */
  const handleReferenceSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file (PNG, JPG, or WEBP)");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      toast.error("Image is larger than 12MB");
      return;
    }

    setReferenceFile(file);
    setReferencePreview(URL.createObjectURL(file));
    setReferenceUrl(null);
    setPanels([]);
    setIsUploadingReference(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("Session expired — please log in again");
        setIsUploadingReference(false);
        return;
      }

      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `panels/from-file/source/${session.user.id}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("wrap-files")
        .upload(path, file, { contentType: file.type, upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(path);
      setReferenceUrl(publicUrl);
      toast.success("Image uploaded");
    } catch (err: any) {
      toast.error("Upload failed: " + (err.message || "Unknown error"));
      setReferenceFile(null);
      setReferencePreview(null);
    } finally {
      setIsUploadingReference(false);
    }
  };

  const clearReference = () => {
    setReferenceFile(null);
    setReferencePreview(null);
    setReferenceUrl(null);
    setPanels([]);
    setRatings({});
  };

  /* ── Generate one panel side ──────────────────────────────────── */
  const generateOne = async (side: typeof PANEL_SIDES[number], index: number): Promise<Partial<PanelResult>> => {
    const t0 = Date.now();
    try {
      const prompt = [userPrompt, side.instruction].filter(Boolean).join("\n\n");

      // Only the DRIVER is AI-flattened (from whatever was uploaded — proof,
      // render, or a single photo). The other sides are derived from it, so this
      // path is reached for the driver (and as a fallback). For a multi-view
      // proof we still narrow to the driver's region; for a single photo we feed
      // the whole image (which IS the driver/main side).
      let srcUrl = referenceUrl;
      if (side.key === "driver") {
        const driverCrop = await cropProofSide(referenceUrl!, "driver");
        if (driverCrop) srcUrl = driverCrop;
      }

      const { data, error } = await supabase.functions.invoke("generate-flat-panel-from-file", {
        body: {
          referenceImageUrl: srcUrl,
          panelSide: side.key,
          userPrompt: prompt,
          variationIndex: index,
          category,
          finish,
          sourceType: "vehicle",
        },
      });

      if (error) {
        throw new Error(await extractInvokeError(error, data) || "Generation failed");
      }
      if (!data?.panelUrl) throw new Error("No panel returned");

      // Fire artboard in background
      supabase.functions.invoke("generate-artboard-flat", {
        body: {
          job_id: `panel-set-${side.key}-${Date.now()}`,
          vehicle_name: `${data.designName || side.label} — ${category}`,
          approved_render_url: data.panelUrl,
          allRenderUrls: [data.panelUrl],
        },
      }).catch(() => {});

      return {
        status: "done",
        panelUrl: data.panelUrl,
        designName: data.designName || side.label,
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

  /* ── Passenger = Driver mirrored (no AI, no windows, exact match) ── */
  // A vehicle's two sides are the SAME design, flipped. Mirroring the clean
  // driver panel in-browser kills the passenger-side window problem entirely
  // and guarantees the two big sides match.
  const mirrorPanel = async (driverUrl: string): Promise<Partial<PanelResult> | null> => {
    try {
      // Pull the driver image through the Supabase client (NOT <img> crossOrigin)
      // so the canvas never taints — that taint was silently failing the mirror.
      const m = driverUrl.match(/\/wrap-files\/(.+?)(\?|$)/);
      if (!m) throw new Error("no path");
      const srcPath = decodeURIComponent(m[1]);
      const { data: blobIn, error: dErr } = await supabase.storage.from("wrap-files").download(srcPath);
      if (dErr || !blobIn) throw dErr || new Error("download failed");
      const bmp = await createImageBitmap(blobIn);
      const canvas = document.createElement("canvas");
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no ctx");
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(bmp, 0, 0);
      const blobOut: Blob = await new Promise((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png")
      );
      const outPath = `panels/from-file/${Date.now()}_passenger_mirror.png`;
      const { error } = await supabase.storage.from("wrap-files").upload(outPath, blobOut, { contentType: "image/png", upsert: true });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(outPath);
      return { status: "done", panelUrl: publicUrl, designName: "Passenger Side Wrap (driver mirrored)", patternId: null };
    } catch (e) {
      console.error("[mirrorPanel] failed, falling back to AI:", e);
      return null;
    }
  };

  // Load the clean driver panel via the Supabase client (no canvas taint).
  const loadDriverBitmap = async (driverUrl: string): Promise<ImageBitmap> => {
    const m = driverUrl.match(/\/wrap-files\/(.+?)(\?|$)/);
    if (!m) throw new Error("no path");
    const { data: blobIn, error } = await supabase.storage.from("wrap-files").download(decodeURIComponent(m[1]));
    if (error || !blobIn) throw error || new Error("download failed");
    return await createImageBitmap(blobIn);
  };

  const uploadCanvas = async (canvas: HTMLCanvasElement, tag: string): Promise<string> => {
    const blob: Blob = await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png")
    );
    const outPath = `panels/from-file/${Date.now()}_${tag}.png`;
    const { error } = await supabase.storage.from("wrap-files").upload(outPath, blob, { contentType: "image/png", upsert: true });
    if (error) throw error;
    return supabase.storage.from("wrap-files").getPublicUrl(outPath).data.publicUrl;
  };

  // Derive a side by CENTER-CROPPING the clean driver to that side's aspect.
  // Pure pixels from a window-free source → the derived panel is window-free too.
  const cropFromDriver = async (driverUrl: string, aspect: number, label: string, tag: string): Promise<Partial<PanelResult> | null> => {
    try {
      const bmp = await loadDriverBitmap(driverUrl);
      const sr = bmp.width / bmp.height;
      let cw: number, ch: number, cx: number, cy: number;
      if (sr > aspect) { ch = bmp.height; cw = Math.round(ch * aspect); cx = Math.round((bmp.width - cw) / 2); cy = 0; }
      else { cw = bmp.width; ch = Math.round(cw / aspect); cx = 0; cy = Math.round((bmp.height - ch) / 2); }
      const canvas = document.createElement("canvas");
      canvas.width = cw; canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no ctx");
      ctx.drawImage(bmp, cx, cy, cw, ch, 0, 0, cw, ch);
      const panelUrl = await uploadCanvas(canvas, tag);
      return { status: "done", panelUrl, designName: `${label} Wrap (from driver)`, patternId: null };
    } catch (e) {
      console.error(`[cropFromDriver:${tag}] failed, falling back to AI:`, e);
      return null;
    }
  };

  // Driver is the ONLY AI panel; passenger mirrors it, the rest crop from it.
  const deriveSide = async (sideKey: string, label: string, driverUrl: string): Promise<Partial<PanelResult> | null> => {
    if (sideKey === "passenger") return mirrorPanel(driverUrl);
    return cropFromDriver(driverUrl, SIDE_ASPECT[sideKey] || 1.5, label, `${sideKey}_from_driver`);
  };

  // Crop the uploaded 2D proof to ONE side's region, upload it, return the URL —
  // so the flatten AI sees a single clean side view instead of the full sheet.
  const cropProofSide = async (proofUrl: string, sideKey: string): Promise<string | null> => {
    try {
      const region = PROOF_REGIONS[sideKey];
      if (!region || !proofUrl) return null;
      let bmp: ImageBitmap;
      const m = proofUrl.match(/\/wrap-files\/(.+?)(\?|$)/);
      if (m) {
        const { data, error } = await supabase.storage.from("wrap-files").download(decodeURIComponent(m[1]));
        if (error || !data) return null;
        bmp = await createImageBitmap(data);
      } else {
        const r = await fetch(proofUrl);
        bmp = await createImageBitmap(await r.blob());
      }
      const [fx, fy, fw, fh] = region;
      const sx = Math.round(bmp.width * fx), sy = Math.round(bmp.height * fy);
      const sw = Math.max(1, Math.round(bmp.width * fw)), sh = Math.max(1, Math.round(bmp.height * fh));
      const canvas = document.createElement("canvas");
      canvas.width = sw; canvas.height = sh;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob: Blob = await new Promise((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png")
      );
      const path = `panels/proof-sides/${Date.now()}_${sideKey}.png`;
      const { error } = await supabase.storage.from("wrap-files").upload(path, blob, { contentType: "image/png", upsert: true });
      if (error) return null;
      return supabase.storage.from("wrap-files").getPublicUrl(path).data.publicUrl;
    } catch (e) {
      console.error(`[cropProofSide:${sideKey}] failed, using full sheet:`, e);
      return null;
    }
  };

  /* ── Generate full panel set ──────────────────────────────────── */
  const generatePanelSet = async () => {
    if (!referenceUrl) {
      toast.error("Upload a wrapped vehicle image first");
      return;
    }

    // Initialize all panels as pending
    const initialPanels: PanelResult[] = PANEL_SIDES.map((side) => ({
      key: side.key,
      label: side.label,
      status: "pending",
      panelUrl: null,
      designName: null,
      patternId: null,
      error: null,
      durationMs: null,
      startedAt: null,
    }));
    setPanels(initialPanels);
    setIsRunning(true);
    setBatchStartedAt(Date.now());
    shouldStopRef.current = false;
    setRatings({});

    let driverUrl: string | null = null;
    for (let i = 0; i < PANEL_SIDES.length; i++) {
      if (shouldStopRef.current) break;

      const side = PANEL_SIDES[i];

      // Mark running with timestamp
      setPanels((prev) => prev.map((p, idx) =>
        idx === i ? { ...p, status: "running" as const, startedAt: Date.now() } : p
      ));

      // Driver is the only AI-flattened panel (works for proof / render / single
      // photo). Every other side is derived (mirror/crop) from that clean driver,
      // so NO side can contain a window, whatever was uploaded.
      let result: Partial<PanelResult>;
      if (side.key === "driver") {
        result = await generateOne(side, i);
        if (result.status === "done" && result.panelUrl) driverUrl = result.panelUrl;
      } else if (driverUrl) {
        const t0 = Date.now();
        const derived = await deriveSide(side.key, side.label, driverUrl);
        result = derived ? { ...derived, durationMs: Date.now() - t0 } : await generateOne(side, i);
      } else {
        result = await generateOne(side, i);
      }

      // Update with result
      setPanels((prev) => prev.map((p, idx) =>
        idx === i ? { ...p, ...result, startedAt: null } : p
      ));

      if (result.status === "done") {
        toast.success(`${side.label} panel complete`);
      } else {
        toast.error(`${side.label} failed: ${result.error}`);
      }

      // Small delay between calls
      if (i < PANEL_SIDES.length - 1 && !shouldStopRef.current) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    setIsRunning(false);
    queryClient.invalidateQueries({ queryKey: ["panel-gallery"] });
    toast.success("Panel set complete!");
  };

  const stopGeneration = () => {
    shouldStopRef.current = true;
    toast.info("Stopping after current panel...");
  };

  /* ── Regenerate single panel ──────────────────────────────────── */
  const regeneratePanel = async (index: number) => {
    const panel = panels[index];
    if (!panel || !referenceUrl) return;

    // Clean up old result
    if (panel.patternId) {
      await supabase.from("designpanelpro_patterns").delete().eq("id", panel.patternId);
    }
    if (panel.panelUrl) {
      const match = panel.panelUrl.match(/wrap-files\/(.+?)(\?|$)/);
      if (match) await supabase.storage.from("wrap-files").remove([match[1]]);
    }

    setPanels((prev) => prev.map((p, idx) =>
      idx === index ? { ...p, status: "running" as const, panelUrl: null, designName: null, patternId: null, error: null, startedAt: Date.now() } : p
    ));

    const side = PANEL_SIDES[index];
    // Non-driver regen re-derives from the clean driver (can't reintroduce a
    // window); only the driver regen re-flattens from the upload.
    let result: Partial<PanelResult>;
    if (side.key !== "driver") {
      const driverUrl = panels.find((p) => p.key === "driver" && p.status === "done")?.panelUrl;
      const t0 = Date.now();
      const derived = driverUrl ? await deriveSide(side.key, side.label, driverUrl) : null;
      result = derived ? { ...derived, durationMs: Date.now() - t0 } : await generateOne(side, index);
    } else {
      result = await generateOne(side, index);
    }

    setPanels((prev) => prev.map((p, idx) =>
      idx === index ? { ...p, ...result, startedAt: null } : p
    ));

    queryClient.invalidateQueries({ queryKey: ["panel-gallery"] });
    if (result.status === "done") toast.success(`${side.label} regenerated`);
    else toast.error(`${side.label} failed: ${result.error}`);
  };

  /* ── Revise single panel with notes ────────────────────────────── */
  const revisePanel = async (index: number) => {
    const panel = panels[index];
    const note = reviseNotes[panel.key]?.trim();
    if (!panel || !referenceUrl || !note) {
      toast.error("Enter revision notes first");
      return;
    }

    setRevisingPanel(panel.key);
    setPanels((prev) => prev.map((p, idx) =>
      idx === index ? { ...p, status: "running" as const, error: null, startedAt: Date.now() } : p
    ));

    const side = PANEL_SIDES[index];
    const revisionPrompt = [
      userPrompt,
      side.instruction,
      `\n\nREVISION: The previous panel output needs these fixes: ${note}\nKeep everything else the same — only fix what was called out.`,
    ].filter(Boolean).join("\n\n");

    const t0 = Date.now();
    try {
      const { data, error } = await supabase.functions.invoke("generate-flat-panel-from-file", {
        body: {
          referenceImageUrl: referenceUrl,
          panelSide: side.key,
          userPrompt: revisionPrompt,
          variationIndex: index,
          category,
          finish,
        },
      });

      if (error) throw new Error(await extractInvokeError(error, data) || "Revision failed");
      if (!data?.panelUrl) throw new Error("No panel returned");

      setPanels((prev) => prev.map((p, idx) =>
        idx === index ? {
          ...p,
          status: "done" as const,
          panelUrl: data.panelUrl,
          designName: data.designName || side.label,
          patternId: data.patternId || null,
          durationMs: Date.now() - t0,
          error: null,
          startedAt: null,
        } : p
      ));

      setReviseNotes((prev) => ({ ...prev, [panel.key]: "" }));
      queryClient.invalidateQueries({ queryKey: ["panel-gallery"] });
      toast.success(`${side.label} revised`);
    } catch (err: any) {
      setPanels((prev) => prev.map((p, idx) =>
        idx === index ? { ...p, status: "failed" as const, error: err.message, durationMs: Date.now() - t0, startedAt: null } : p
      ));
      toast.error(`Revision failed: ${err.message}`);
    } finally {
      setRevisingPanel(null);
    }
  };

  /* ── Delete single panel ──────────────────────────────────────── */
  const deletePanel = async (index: number) => {
    const panel = panels[index];
    if (!panel) return;
    try {
      if (panel.patternId) {
        await supabase.from("designpanelpro_patterns").delete().eq("id", panel.patternId);
      }
      if (panel.panelUrl) {
        const match = panel.panelUrl.match(/wrap-files\/(.+?)(\?|$)/);
        if (match) await supabase.storage.from("wrap-files").remove([match[1]]);
      }
      setPanels((prev) => prev.map((p, idx) =>
        idx === index ? { ...p, status: "pending" as const, panelUrl: null, designName: null, patternId: null, error: null, durationMs: null } : p
      ));
      queryClient.invalidateQueries({ queryKey: ["panel-gallery"] });
      toast.success(`${panel.label} panel deleted`);
    } catch (err: any) {
      toast.error("Delete failed: " + (err.message || "Unknown error"));
    }
  };

  /* ── Computed ─────────────────────────────────────────────────── */
  const doneCount = panels.filter((p) => p.status === "done").length;
  const failedCount = panels.filter((p) => p.status === "failed").length;
  const progress = panels.length > 0 ? (doneCount / panels.length) * 100 : 0;
  const canGenerate = !!referenceUrl && !isUploadingReference && !isRunning;

  /* ── Render ───────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-background p-4 md:p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileImage className="h-6 w-6 text-cyan-400" />
          Flat Panel Set Generator
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload a wrapped vehicle image — AI generates flat panels for all 6 sides (driver, passenger, hood, roof, front, rear).
        </p>
      </div>

      {/* Upload + Settings row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upload */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">1. Upload Wrapped Vehicle</CardTitle>
            <CardDescription>A photo or 3D render of a vehicle with a wrap on it.</CardDescription>
          </CardHeader>
          <CardContent>
            {!referencePreview ? (
              <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary transition-colors">
                <Input
                  id="reference-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleReferenceSelect}
                  disabled={isUploadingReference || isRunning}
                  className="hidden"
                />
                <Label htmlFor="reference-upload" className="cursor-pointer flex flex-col items-center gap-2">
                  {isUploadingReference ? (
                    <>
                      <Loader2 className="w-12 h-12 animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Uploading...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-12 h-12 text-muted-foreground" />
                      <span className="text-sm font-medium">Click to upload</span>
                      <span className="text-xs text-muted-foreground">PNG, JPG, or WEBP (max 12MB)</span>
                    </>
                  )}
                </Label>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="aspect-video bg-secondary/30 rounded-lg overflow-hidden relative">
                  <img src={referencePreview} alt="Reference" className="w-full h-full object-cover" />
                  {isUploadingReference && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-white" />
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{referenceFile?.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {referenceFile && `${(referenceFile.size / 1024 / 1024).toFixed(2)} MB`}
                      {referenceUrl && (
                        <span className="ml-2 inline-flex items-center gap-1 text-green-400">
                          <CheckCircle2 className="h-3 w-3" /> Ready
                        </span>
                      )}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={clearReference} disabled={isUploadingReference || isRunning} className="gap-1">
                    <Trash2 className="h-3 w-3" /> Replace
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Settings + Generate */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Generate All Panels</CardTitle>
            <CardDescription>Generates flat panels for Driver, Passenger, Hood, Roof, Front, and Rear — 6 panels total.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
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
              <div className="space-y-1.5">
                <Label className="text-xs">Finish</Label>
                <Select value={finish} onValueChange={(v: any) => setFinish(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Gloss">Gloss</SelectItem>
                    <SelectItem value="Satin">Satin</SelectItem>
                    <SelectItem value="Matte">Matte</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Optional Direction</Label>
              <Textarea
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                placeholder="e.g. keep the same color palette, clean up the edges"
                className="text-xs min-h-[64px]"
                disabled={isRunning}
              />
            </div>

            <div className="flex gap-2">
              {!isRunning ? (
                <Button
                  onClick={generatePanelSet}
                  disabled={!canGenerate}
                  className="flex-1 gap-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white"
                >
                  <Play className="h-4 w-4" /> Generate 6 Panels
                </Button>
              ) : (
                <Button onClick={stopGeneration} variant="destructive" className="flex-1 gap-2">
                  <Square className="h-4 w-4" /> Stop
                </Button>
              )}
            </div>

            {/* Progress */}
            {panels.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{doneCount}/{panels.length} panels</span>
                  <span className="flex gap-3">
                    <span className="text-green-400">{doneCount} done</span>
                    {failedCount > 0 && <span className="text-red-400">{failedCount} failed</span>}
                    {batchStartedAt && isRunning && (
                      <span className="text-cyan-400">{fmtSecs(liveElapsed(batchStartedAt))} elapsed</span>
                    )}
                  </span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ──────────────────────────────────────────────────────────── */}
      {/* STICKY LIVE STATUS BANNER — visible no matter where you scroll */}
      {/* ──────────────────────────────────────────────────────────── */}
      {isRunning && runningPanel && (
        <div className="sticky top-0 z-30 -mx-4 md:-mx-6 px-4 md:px-6 py-3 bg-gradient-to-r from-cyan-950/95 via-blue-950/95 to-cyan-950/95 backdrop-blur border-y border-cyan-500/40 shadow-lg shadow-cyan-500/10">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 text-cyan-400 animate-spin shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-cyan-100 truncate">
                Generating panel {runningIndex + 1} of {panels.length}: {runningPanel.label}
              </p>
              <p className="text-xs text-cyan-300/80">
                {runningPanel.startedAt ? `${fmtSecs(liveElapsed(runningPanel.startedAt))} on this panel` : "Starting..."}
                {batchStartedAt && ` · ${fmtSecs(liveElapsed(batchStartedAt))} total · ${doneCount}/${panels.length} done`}
              </p>
            </div>
            <Button onClick={stopGeneration} variant="destructive" size="sm" className="gap-1 shrink-0">
              <Square className="h-3.5 w-3.5" /> Stop
            </Button>
          </div>
        </div>
      )}

      {/* Panel Set Results */}
      {panels.length > 0 && (
        <>
          <h2 className="text-lg font-bold text-white">Panel Set</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {panels.map((panel, idx) => (
              <Card
                key={panel.key}
                ref={panel.status === "running" ? (el) => { runningCardRef.current = el; } : undefined}
                className={cn(
                  "overflow-hidden transition-all",
                  panel.status === "running" && "ring-2 ring-cyan-400 shadow-lg shadow-cyan-500/30",
                  panel.status === "failed" && "border-red-500/50",
                )}
              >
                <div className={cn(
                  "aspect-video bg-secondary/30 relative flex items-center justify-center overflow-hidden",
                  panel.status === "running" && "bg-gradient-to-br from-cyan-950/60 via-blue-950/60 to-cyan-950/60",
                )}>
                  {panel.status === "pending" && (
                    <div className="text-center">
                      <ImageIcon className="h-6 w-6 text-muted-foreground/40 mx-auto mb-1" />
                      <span className="text-xs text-muted-foreground">{panel.label}</span>
                    </div>
                  )}
                  {panel.status === "running" && (
                    <div className="text-center">
                      <Loader2 className="h-10 w-10 text-cyan-400 animate-spin mx-auto mb-2" />
                      <p className="text-sm font-semibold text-cyan-200">Generating {panel.label}</p>
                      <p className="text-2xl font-bold text-cyan-100 tabular-nums mt-1">
                        {panel.startedAt ? fmtSecs(liveElapsed(panel.startedAt)) : "0s"}
                      </p>
                      <p className="text-[10px] text-cyan-400/70 mt-0.5">Gemini is rendering...</p>
                    </div>
                  )}
                  {panel.status === "done" && panel.panelUrl && (
                    <img src={panel.panelUrl} alt={panel.designName || panel.label} className="w-full h-full object-cover" loading="lazy" />
                  )}
                  {panel.status === "failed" && (
                    <div className="text-center px-3">
                      <XCircle className="h-6 w-6 text-red-400 mx-auto mb-1" />
                      <span className="text-xs text-red-400 line-clamp-2">{panel.error}</span>
                    </div>
                  )}

                  {panel.status === "done" && (
                    <div className="absolute top-2 right-2">
                      <Badge className="bg-green-600 text-[10px]">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        {panel.durationMs ? `${(panel.durationMs / 1000).toFixed(0)}s` : "Done"}
                      </Badge>
                    </div>
                  )}

                  <div className="absolute top-2 left-2">
                    <Badge variant="outline" className="bg-black/60 text-[10px] text-white border-white/20">
                      {panel.label}
                    </Badge>
                  </div>
                </div>

                <div className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">
                        {panel.designName || panel.label}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{finish} · {category}</p>
                    </div>
                  </div>

                  {panel.status === "done" && (
                    <div className="space-y-2">
                      <StarRating
                        value={ratings[panel.key] || null}
                        onChange={(v) => setRatings((prev) => ({ ...prev, [panel.key]: v }))}
                      />
                      <div className="flex gap-1 flex-wrap">
                        {panel.panelUrl && (
                          <Button
                            variant="ghost" size="sm"
                            className="h-7 px-2 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                            onClick={() => downloadImage(panel.panelUrl!, panel.designName || panel.label)}
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
                        <Button
                          variant="ghost" size="sm"
                          className="h-7 px-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                          onClick={() => deletePanel(idx)}
                        >
                          <Trash2 className="h-3 w-3 mr-1" /> Delete
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Revise input */}
                  {panel.status === "done" && (
                    <div className="flex gap-1.5 mt-1">
                      <Input
                        value={reviseNotes[panel.key] || ""}
                        onChange={(e) => setReviseNotes((prev) => ({ ...prev, [panel.key]: e.target.value }))}
                        placeholder="Revision notes... e.g. more blue, less busy"
                        className="text-xs h-7 flex-1"
                        disabled={revisingPanel === panel.key}
                        onKeyDown={(e) => { if (e.key === "Enter") revisePanel(idx); }}
                      />
                      <Button
                        variant="outline" size="sm"
                        className="h-7 px-2 text-xs text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 shrink-0"
                        onClick={() => revisePanel(idx)}
                        disabled={!reviseNotes[panel.key]?.trim() || revisingPanel === panel.key}
                      >
                        {revisingPanel === panel.key ? <Loader2 className="h-3 w-3 animate-spin" /> : "Revise"}
                      </Button>
                    </div>
                  )}

                  {panel.status === "failed" && !isRunning && (
                    <Button
                      variant="outline" size="sm"
                      className="w-full gap-1 text-xs"
                      onClick={() => regeneratePanel(idx)}
                    >
                      <RefreshCw className="h-3 w-3" /> Retry
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Empty state */}
      {panels.length === 0 && (
        <Card className="p-12 text-center">
          <ImageIcon className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">
            {referenceUrl ? "Ready to generate panel set" : "Upload a wrapped vehicle to begin"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {referenceUrl
              ? "Click \"Generate 6 Panels\" to create flat panels for every side of the vehicle."
              : "The AI reads the wrap off the vehicle and produces flat, print-ready panels for all 6 sides."}
          </p>
          {referenceUrl && (
            <Button onClick={generatePanelSet} disabled={!canGenerate} className="mt-4 gap-2">
              <Zap className="h-4 w-4" /> Generate 6 Panels
            </Button>
          )}
        </Card>
      )}
    </div>
  );
}
