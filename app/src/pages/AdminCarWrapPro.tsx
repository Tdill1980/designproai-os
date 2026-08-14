/**
 * AdminCarWrapPro — CarWrapPro™ Design Assets admin production page.
 *
 * The dedicated home for every asset the prompt-to-production backend creates.
 * Runs the full pipeline end to end from one button:
 *
 *   1. designpro-flat-art          → layered flat design (background + transparent
 *                                    elements + combined) + true-dimension artboard
 *   2. designpro-recreate-3d       → 7-angle 3D proof set projected from the artboard
 *   3. carwrappro-production-pack  → per-panel print files (true size + 2" bleed,
 *                                    150 DPI geometry), the 2D Production Proof
 *                                    approval sheet, and the asset registry rows
 *
 * Every asset is persisted in carwrappro_runs / carwrappro_assets and listed here.
 * Built fresh to docs/WHITE_UI_STANDARD.md — white surface, gray-900/600/500 text,
 * blue→magenta gradient as accent only.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Check, Download, Layers, Loader2, Package, Sparkles, Upload } from "lucide-react";

const BODY_TYPES = ["sedan", "suv", "truck", "van"] as const;

interface RunRow {
  id: string;
  status: string;
  mode: string | null;
  prompt: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  finish: string | null;
  company_name: string | null;
  dims_source: string | null;
  coverage_sq_ft: number | null;
  reference_image_url: string | null;
  revision_of: string | null;
  revision_number: number | null;
  included_revisions: number | null;
  paid: boolean | null;
  created_at: string;
}

// Pay-to-play: revisions included per design, fee after. Adjust the fee here.
const INCLUDED_REVISIONS = 4;
const REVISION_FEE_LABEL = "$25";

interface AssetRowUI {
  id: string;
  run_id: string;
  kind: string;
  label: string | null;
  view_type: string | null;
  panel_label: string | null;
  width_inches: number | null;
  height_inches: number | null;
  bleed_inches: number | null;
  dpi: number | null;
  scale_pct: number | null;
  url: string;
  sort_order: number | null;
}

type StepState = "idle" | "running" | "done" | "failed";

const ASSET_SECTIONS: { title: string; kinds: string[]; transparent?: boolean }[] = [
  { title: "Design Layers — L0 base · L2 structural · L3 branding", kinds: ["reference", "background", "structural", "elements", "combined"], transparent: true },
  { title: "Coordinate-Locked Element Crops (transparent PNGs)", kinds: ["element_crop"] },
  { title: "Flat Panel Artboard (true dimensions)", kinds: ["artboard"] },
  { title: 'Print Panels — actual size + 2" bleed @ 150 DPI', kinds: ["panel_print"] },
  { title: "3D Proofs — 7-angle set", kinds: ["proof_3d"] },
  { title: "2D Production Proof (approval sheet)", kinds: ["production_proof_2d"] },
];

// Transparent layers render on a checkerboard so alpha is visible.
const TRANSPARENT_KINDS = ["elements", "structural", "element_crop"];

export default function AdminCarWrapPro() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"commercial" | "restyle">("commercial");
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [year, setYear] = useState("2024");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [bodyType, setBodyType] = useState<(typeof BODY_TYPES)[number]>("truck");
  const [finish, setFinish] = useState("Gloss");
  const [refFile, setRefFile] = useState<File | null>(null);
  const [refPreview, setRefPreview] = useState("");

  const [steps, setSteps] = useState<{ label: string; state: StepState }[]>([]);
  const [busy, setBusy] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [revisionOf, setRevisionOf] = useState<{ id: string; nextRev: number; included: number } | null>(null);
  // Reference carried over from the run being revised (the retrigger keeps
  // matching the SAME image unless a new file is uploaded).
  const [carriedRefUrl, setCarriedRefUrl] = useState("");

  const { data: runs } = useQuery({
    queryKey: ["carwrappro-runs"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("carwrappro_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return (data || []) as RunRow[];
    },
  });

  const { data: assets } = useQuery({
    queryKey: ["carwrappro-assets", runs?.map((r) => r.id).join(",")],
    enabled: !!runs?.length,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("carwrappro_assets")
        .select("*")
        .in("run_id", runs!.map((r) => r.id))
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as AssetRowUI[];
    },
  });

  const onRef = (f: File | undefined) => {
    if (!f) return;
    setRefFile(f);
    setRefPreview(URL.createObjectURL(f));
  };

  // Downscale reference in-browser (<=1600px) — full-res uploads blew the edge
  // worker's memory when base64-encoded server-side (546).
  const downscaleRef = async (file: File, maxEdge = 1600): Promise<Blob> => {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
      if (scale >= 1) return file;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.92));
      return blob || file;
    } catch {
      return file;
    }
  };

  const setStep = (i: number, state: StepState) =>
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, state } : s)));

  const startRevision = (run: RunRow) => {
    setPrompt(run.prompt || "");
    setMode((run.mode as "commercial" | "restyle") || "commercial");
    setCompanyName(run.company_name || "");
    setYear(run.vehicle_year || "2024");
    setMake(run.vehicle_make || "");
    setModel(run.vehicle_model || "");
    setFinish(run.finish || "Gloss");
    setCarriedRefUrl(run.reference_image_url || "");
    setRevisionOf({
      id: run.id,
      nextRev: (run.revision_number ?? 0) + 1,
      included: run.included_revisions ?? INCLUDED_REVISIONS,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const markPaid = async (run: RunRow, paid: boolean) => {
    const { error } = await (supabase as any).from("carwrappro_runs").update({ paid }).eq("id", run.id);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["carwrappro-runs"] });
  };

  const canRun = (prompt.trim() || refFile || carriedRefUrl) && make.trim() && model.trim() && !busy;

  const runPipeline = async () => {
    setBusy(true);
    setPipelineError(null);
    setSteps([
      { label: "Flat design layers + artboard (true dimensions)", state: "running" },
      { label: "7-angle 3D proof set", state: "idle" },
      { label: 'Print panels (+2" bleed, 150 DPI) + 2D Production Proof + asset registry', state: "idle" },
    ]);
    try {
      let referenceImageUrl = "";
      if (refFile) {
        const small = await downscaleRef(refFile);
        const path = `carwrappro/refs/${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await supabase.storage.from("wrap-files").upload(path, small, { upsert: true, contentType: "image/jpeg" });
        if (upErr) throw new Error(`Reference upload failed: ${upErr.message}`);
        const { data: signed } = await supabase.storage.from("wrap-files").createSignedUrl(path, 60 * 60 * 24 * 7);
        referenceImageUrl = signed?.signedUrl || "";
      }
      // Revising a recreate run with no new upload → keep matching the SAME image.
      if (!referenceImageUrl && carriedRefUrl) referenceImageUrl = carriedRefUrl;

      // Pull the REAL backend error out of a non-2xx invoke (the SDK's
      // error.message is just "non-2xx status code", which tells us nothing).
      const realError = async (error: any, data: any, fallback: string): Promise<string> => {
        if (data?.error) return data.error;
        try {
          const body = await error?.context?.json?.();
          if (body?.error) return body.error;
        } catch { /* body not json */ }
        return error?.message || fallback;
      };

      // Shared canvas + storage helpers (panels can be generated in step 1 in
      // recreate mode, so these live up front).
      const PRINT_DPI = 150, BLEED = 2, MAX_EDGE = 4096;
      const runId = crypto.randomUUID();
      const dir = `carwrappro/${runId}`;
      const loadImg = (url: string) =>
        new Promise<HTMLImageElement>((res, rej) => {
          const i = new window.Image();
          i.crossOrigin = "anonymous";
          i.onload = () => res(i);
          i.onerror = () => rej(new Error(`image load failed: ${url.slice(0, 60)}`));
          i.src = url;
        });
      const blobOf = (c: HTMLCanvasElement) =>
        new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
      const drawCover = (dctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) => {
        const sr = img.width / img.height, tr = w / h;
        let sw: number, sh: number, sx: number, sy: number;
        if (sr > tr) { sh = img.height; sw = sh * tr; sx = (img.width - sw) / 2; sy = 0; }
        else { sw = img.width; sh = sw / tr; sx = 0; sy = (img.height - sh) / 2; }
        dctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
      };
      const uploadPng = async (name: string, blob: Blob): Promise<string> => {
        const path = `${dir}/${name}`;
        const { error: upErr } = await supabase.storage.from("wrap-files").upload(path, blob, { upsert: true, contentType: "image/png" });
        if (upErr) throw new Error(`upload ${name}: ${upErr.message}`);
        return path;
      };
      const signPath = async (path: string): Promise<string> => {
        const { data: signed } = await supabase.storage.from("wrap-files").createSignedUrl(path, 60 * 60 * 24 * 365);
        if (!signed?.signedUrl) throw new Error(`sign failed: ${path}`);
        return signed.signedUrl;
      };

      type PanelFile = { panelLabel: string; path?: string; url?: string; widthInches: number; heightInches: number; bleedInches: number; dpi: number; scalePct: number };
      const PANEL_LABELS = ["DRIVER SIDE", "PASSENGER SIDE", "HOOD", "ROOF", "FRONT", "REAR"];

      // One side recreated by AI, anchored to its view of the reference.
      // RecreatePro runs use recreatepro-flat-panels (pure reproduction);
      // prompt runs anchor to our own artboard via designpro-flat-art.
      // In recreate mode the brief/prompt box carries the edit instruction
      // (e.g. "change the phone number to 555-1234"). Pass it through as the
      // editNote so revisions actually change the artwork instead of
      // re-reproducing the original unchanged.
      const editNote = prompt.trim();
      const recreateSide = async (fn: string, sideLabel: string, refUrl: string, attempt = 1): Promise<any> => {
        const { data: sideRes, error: sideErr } = await supabase.functions.invoke(fn, {
          body: {
            side: sideLabel, referenceImageUrl: refUrl, bleedInches: BLEED, runId,
            vehicleYear: year, vehicleMake: make, vehicleModel: model, bodyType, finish, mode,
            editNote,
          },
        });
        if (sideErr || !sideRes?.success || !sideRes?.url) {
          if (attempt < 2) return recreateSide(fn, sideLabel, refUrl, attempt + 1);
          throw new Error(`${sideLabel}: ${await realError(sideErr, sideRes, "side generation failed")}`);
        }
        return sideRes;
      };

      const isRecreate = !!referenceImageUrl;
      let panelsList: { label: string; widthInches: number; heightInches: number }[] = [];
      let panelFiles: PanelFile[] = [];
      let combinedUrl = "", backgroundUrl = "", elementsUrl = "", artboardUrl = "", dimsSource = "";
      const extraAssets: { kind: string; label: string; url: string }[] = [];
      let combinedImg: HTMLImageElement;
      let artboardFor3D = "";

      if (isRecreate) {
        // 1 (RECREATEPRO MODE) — REFERENCE-FIRST via recreatepro-flat-panels.
        // The customer's image is the single source of truth: the layer set
        // (transparent PNG elements + clean background + combined) is
        // extracted from it, every panel is recreated from ITS view of it,
        // the artboard is composed from those faithful panels, and the 3D
        // step projects from the reference itself.
        const layersPromise = supabase.functions.invoke("recreatepro-flat-panels", {
          body: { referenceImageUrl, runId, vehicleYear: year, vehicleMake: make, vehicleModel: model, bodyType, finish, bleedInches: BLEED, editNote },
        });
        const sides = await Promise.all(PANEL_LABELS.map((l) => recreateSide("recreatepro-flat-panels", l, referenceImageUrl)));
        const { data: layersRes, error: layersErr } = await layersPromise;
        if (layersErr || !layersRes?.success) {
          toast({ title: "Layer extraction failed — continuing", description: await realError(layersErr, layersRes, "no layers"), variant: "destructive" });
        } else {
          backgroundUrl = layersRes.backgroundUrl || "";
          elementsUrl = layersRes.elementsUrl || "";
          combinedUrl = layersRes.combinedUrl || "";
          for (const ec of (layersRes.elementCrops || []) as { label: string; url: string }[]) {
            extraAssets.push({ kind: "element_crop", label: ec.label, url: ec.url });
          }
        }
        panelsList = sides.map((s: any) => ({ label: s.side, widthInches: s.trimWidthInches, heightInches: s.trimHeightInches }));
        panelFiles = sides.map((s: any) => ({
          panelLabel: s.side, url: s.url,
          widthInches: s.bleedWidthInches, heightInches: s.bleedHeightInches,
          bleedInches: BLEED, dpi: PRINT_DPI,
          scalePct: s.effectiveDpi ? Math.round((s.effectiveDpi / PRINT_DPI) * 1000) / 10 : 0,
        }));
        dimsSource = "per-side recreate (reference-anchored)";
        const driver = sides.find((s: any) => s.side === "DRIVER SIDE") || sides[0];
        if (!combinedUrl) combinedUrl = driver.url;
        combinedImg = await loadImg(combinedUrl);
        artboardFor3D = referenceImageUrl;

        // Compose the true-dimension artboard FROM the faithful per-side panels.
        const ab = document.createElement("canvas");
        ab.width = 2400; ab.height = 1500;
        const actx = ab.getContext("2d")!;
        actx.fillStyle = "#ffffff"; actx.fillRect(0, 0, 2400, 1500);
        actx.fillStyle = "#111111"; actx.textAlign = "center"; actx.font = "bold 40px Poppins, Arial, sans-serif";
        actx.fillText(`${year} ${make} ${model} WRAP`.toUpperCase(), 1200, 64);
        actx.fillStyle = "#777777"; actx.font = "600 22px Inter, Arial, sans-serif";
        actx.fillText(`ALL PANELS @ ACTUAL SIZE   ${PRINT_DPI} DPI   ${BLEED}" BLEED   ${finish.toUpperCase()}`, 1200, 104);
        const boxes: Record<string, [number, number, number, number]> = {
          HOOD: [60, 210, 380, 230], ROOF: [60, 510, 380, 360],
          "DRIVER SIDE": [500, 210, 1320, 360], "PASSENGER SIDE": [500, 630, 1320, 360],
          FRONT: [1860, 230, 480, 180], REAR: [1860, 490, 480, 180],
        };
        actx.textAlign = "left";
        for (const s of sides as any[]) {
          const box = boxes[s.side];
          if (!box) continue;
          const [x, y, w, h] = box;
          try {
            const img = await loadImg(s.url);
            actx.fillStyle = "#cccccc"; actx.fillRect(x - 2, y - 2, w + 4, h + 4);
            drawCover(actx, img, x, y, w, h);
          } catch { /* leave the box empty rather than fail the artboard */ }
          actx.fillStyle = "#111111"; actx.font = "bold 24px Inter, Arial, sans-serif";
          actx.fillText(`${s.side === "FRONT" ? "FRONT BUMPER" : s.side === "REAR" ? "REAR BUMPER" : s.side}: ${s.trimWidthInches}" x ${s.trimHeightInches}"`, x, y - 12);
        }
        actx.fillStyle = "#555555"; actx.font = "600 20px Inter, Arial, sans-serif";
        actx.fillText("Recreated from customer reference — every panel anchored to its view of the proof.", 60, 1460);
        artboardUrl = await signPath(await uploadPng("artboard.png", await blobOf(ab)));
      } else {
        // 1 (PROMPT MODE) — flat-first design (layers + artboard at true dims)
        const { data: flat, error: flatErr } = await supabase.functions.invoke("designpro-flat-art", {
          body: { prompt, referenceImageUrl, mode, companyName, phone, url: website, vehicleYear: year, vehicleMake: make, vehicleModel: model, bodyType, finish },
        });
        if (flatErr || !flat?.success || !flat?.combinedUrl) {
          throw new Error(`Flat design failed: ${await realError(flatErr, flat, "no flat design returned")}`);
        }
        panelsList = flat.panels;
        combinedUrl = flat.combinedUrl;
        backgroundUrl = flat.backgroundUrl || "";
        elementsUrl = flat.elementsUrl || "";
        if (flat.structuralUrl) extraAssets.push({ kind: "structural", label: "Structural layer (L2, transparent)", url: flat.structuralUrl });
        artboardUrl = flat.artboardUrl || "";
        dimsSource = flat.dimsSource || "";
        artboardFor3D = flat.artboardUrl;
        combinedImg = await loadImg(flat.combinedUrl);
      }
      setStep(0, "done");
      setStep(1, "running");

      // 2 — 7-angle 3D proofs. In recreate mode they project from the
      // CUSTOMER'S reference; in prompt mode from our artboard. Continues
      // without them if it fails; the production pack still ships.
      let renderUrls: Record<string, string> = {};
      try {
        const { data: r3d, error: r3dErr } = await supabase.functions.invoke("designpro-recreate-3d", {
          body: { artboardUrl: artboardFor3D, designDescription: prompt, vehicleYear: year, vehicleMake: make, vehicleModel: model, finish },
        });
        if (r3dErr || !r3d?.success) throw new Error(await realError(r3dErr, r3d, "3D proofs failed"));
        renderUrls = r3d.renderUrls || {};
        setStep(1, "done");
      } catch (e: any) {
        setStep(1, "failed");
        toast({ title: "3D proofs failed — continuing", description: e?.message, variant: "destructive" });
      }

      // 3 — print panels + 2D production proof, composed IN THE BROWSER
      // (edge workers 546 on multi-megapixel slicing; backend only registers).
      setStep(2, "running");

      if (!isRecreate) {
        // PROMPT MODE panels: one AI pass per side anchored to our artboard,
        // canvas slice of the combined design as per-side fallback.
        const sliceFallback = async (p: { label: string; widthInches: number; heightInches: number }): Promise<PanelFile> => {
          const inW = p.widthInches + BLEED * 2, inH = p.heightInches + BLEED * 2;
          const scale = Math.min(1, MAX_EDGE / (Math.max(inW, inH) * PRINT_DPI));
          const pxW = Math.max(1, Math.round(inW * PRINT_DPI * scale));
          const pxH = Math.max(1, Math.round(inH * PRINT_DPI * scale));
          const c = document.createElement("canvas");
          c.width = pxW; c.height = pxH;
          const pctx = c.getContext("2d")!;
          const mirror = p.label === "PASSENGER SIDE" && mode === "restyle";
          if (mirror) { pctx.translate(pxW, 0); pctx.scale(-1, 1); }
          drawCover(pctx, combinedImg, 0, 0, pxW, pxH);
          if (mirror) pctx.setTransform(1, 0, 0, 1, 0, 0);
          const path = await uploadPng(`panels/${p.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`, await blobOf(c));
          return { panelLabel: p.label, path, widthInches: inW, heightInches: inH, bleedInches: BLEED, dpi: PRINT_DPI, scalePct: Math.round(scale * 1000) / 10 };
        };
        panelFiles = await Promise.all(panelsList.map(async (p): Promise<PanelFile> => {
          try {
            const s = await recreateSide("designpro-flat-art", p.label, artboardUrl);
            return {
              panelLabel: p.label, url: s.url,
              widthInches: s.bleedWidthInches ?? p.widthInches + BLEED * 2,
              heightInches: s.bleedHeightInches ?? p.heightInches + BLEED * 2,
              bleedInches: BLEED, dpi: PRINT_DPI,
              scalePct: s.effectiveDpi ? Math.round((s.effectiveDpi / PRINT_DPI) * 1000) / 10 : 0,
            };
          } catch {
            return sliceFallback(p);
          }
        }));
      }

      // 3b — compose the 2D Production Proof (dimensioned views + signature line)
      const W = 2400, H = 1700;
      const sheet = document.createElement("canvas");
      sheet.width = W; sheet.height = H;
      const ctx = sheet.getContext("2d")!;
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
      const coverage = Math.round(panelsList.reduce((acc, p) => acc + (p.widthInches * p.heightInches) / 144, 0));
      ctx.fillStyle = "#111111"; ctx.textAlign = "center";
      ctx.font = "bold 48px Poppins, Arial, sans-serif";
      ctx.fillText("CarWrapPro™ — 2D Production Proof", W / 2, 70);
      ctx.fillStyle = "#555555"; ctx.font = "600 24px Inter, Arial, sans-serif";
      const designName = companyName || (prompt ? `"${prompt.slice(0, 40)}${prompt.length > 40 ? "…" : ""}"` : "Custom Wrap");
      ctx.fillText(`VEHICLE: ${year} ${make} ${model}  |  DESIGN: ${designName}  |  FINISH: ${finish}  |  COVERAGE: ${coverage} SQ FT`, W / 2, 112);
      const viewOrder: { key: string; label: string; dimOf: string | null }[] = [
        { key: "side", label: "Driver Side", dimOf: "DRIVER SIDE" },
        { key: "passenger-side", label: "Passenger Side", dimOf: "PASSENGER SIDE" },
        { key: "front", label: "Front", dimOf: "FRONT" },
        { key: "rear", label: "Rear", dimOf: "REAR" },
        { key: "hood_detail", label: "Hood", dimOf: "HOOD" },
        { key: "roof", label: "Top/Roof", dimOf: "ROOF" },
        { key: "close-up", label: "Close-Up", dimOf: null },
      ];
      const dimOf = (lab: string | null) => {
        const p = lab ? panelsList.find((x) => x.label === lab) : null;
        return p ? `  —  ${p.widthInches}" W × ${p.heightInches}" H` : "";
      };
      const colsX = [60, 840, 1620], tileW = 700, tileH = 394, rowsY = [170, 650, 1130];
      let tile = 0;
      ctx.textAlign = "left";
      for (const v of viewOrder) {
        const u = renderUrls[v.key];
        if (!u) continue;
        try {
          const img = await loadImg(u);
          const x = colsX[tile % 3], y = rowsY[Math.floor(tile / 3)];
          ctx.fillStyle = "#dddddd"; ctx.fillRect(x - 2, y - 2, tileW + 4, tileH + 4);
          drawCover(ctx, img, x, y, tileW, tileH);
          ctx.fillStyle = "#111111"; ctx.font = "bold 24px Inter, Arial, sans-serif";
          ctx.fillText(`${v.label.toUpperCase()}${dimOf(v.dimOf)}`, x, y + tileH + 34);
          tile++;
        } catch { /* skip broken tile */ }
      }
      if (tile === 0) {
        for (const p of panelsList.slice(0, 6)) {
          const x = colsX[tile % 3], y = rowsY[Math.floor(tile / 3)];
          drawCover(ctx, combinedImg, x, y, tileW, tileH);
          ctx.fillStyle = "#111111"; ctx.font = "bold 24px Inter, Arial, sans-serif";
          ctx.fillText(`${p.label}  —  ${p.widthInches}" W × ${p.heightInches}" H`, x, y + tileH + 34);
          tile++;
        }
      }
      ctx.fillStyle = "#cccccc"; ctx.fillRect(60, 1614, W - 120, 2);
      ctx.fillStyle = "#111111"; ctx.font = "bold 26px Inter, Arial, sans-serif";
      ctx.fillText("APPROVED BY: ____________________    SIGNATURE: ____________________    DATE: ______________    |    WePrintWraps.com", 60, 1660);
      const proofSheetPath = await uploadPng("2d-production-proof.png", await blobOf(sheet));

      // 3c — register everything in the asset registry (no image work server-side)
      const { data: pack, error: packErr } = await supabase.functions.invoke("carwrappro-production-pack", {
        body: {
          registerOnly: true, runId,
          prompt, mode, vehicleYear: year, vehicleMake: make, vehicleModel: model, bodyType, finish,
          companyName, phone, website, referenceImageUrl,
          combinedUrl, backgroundUrl, elementsUrl,
          artboardUrl, panels: panelsList, dimsSource, renderUrls,
          panelFiles, proofSheetPath, extraAssets,
          revisionOf: revisionOf?.id || "",
        },
      });
      if (packErr || !pack?.success) {
        throw new Error(`Production pack failed: ${await realError(packErr, pack, "no pack returned")}`);
      }
      setStep(2, "done");
      setOpenRun(pack.runId);
      setRevisionOf(null);
      setCarriedRefUrl("");
      toast({
        title: pack.revisionFeeDue ? `Revision ${pack.revisionNumber} complete — ${REVISION_FEE_LABEL} revision fee due` : "Production pack complete",
        description: `${pack.panelFiles?.length || 0} print panels · ${pack.coverageSqFt} sq ft · all assets saved${pack.revisionNumber ? ` · revision ${pack.revisionNumber}/${pack.includedRevisions}` : ""}`,
      });
      queryClient.invalidateQueries({ queryKey: ["carwrappro-runs"] });
      queryClient.invalidateQueries({ queryKey: ["carwrappro-assets"] });
    } catch (e: any) {
      setSteps((prev) => prev.map((s) => (s.state === "running" ? { ...s, state: "failed" } : s)));
      setPipelineError(e?.message || "Pipeline failed — unknown error");
      toast({ title: "Pipeline failed", description: e?.message || "unknown", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const label = "text-[11px] font-semibold text-gray-500";
  // Explicit white-UI classes — shadcn Input/Textarea default to theme tokens,
  // which resolve to BLACK fields under the app's dark theme (WHITE_UI_STANDARD).
  const inputCls = "mt-1 bg-white border-gray-300 text-gray-900 placeholder:text-gray-400";
  const checker = {
    backgroundImage:
      "linear-gradient(45deg,#ddd 25%,transparent 25%,transparent 75%,#ddd 75%),linear-gradient(45deg,#ddd 25%,#fff 25%,#fff 75%,#ddd 75%)",
    backgroundSize: "16px 16px",
    backgroundPosition: "0 0,8px 8px",
  } as const;

  return (
    <div className="min-h-screen bg-white">
      <div className="h-1 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />
      <div className="max-w-7xl mx-auto px-5 py-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#3b82f6] to-[#ec4899] flex items-center justify-center shadow-sm">
            <Package className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-2xl font-bold">
            <span className="text-gray-900">CarWrap</span>
            <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">Pro</span>
            <span className="text-gray-400 text-xs ml-0.5 align-top">™</span>
            <span className="text-gray-900"> — Design Assets · Production</span>
          </h1>
        </div>
        <p className="text-sm text-gray-500 mb-6">
          One prompt (or one photo) → layered flat design → true-dimension artboard → print panels with 2" bleed →
          7-angle 3D proofs → 2D Production Proof. Every backend asset is saved here.
        </p>

        {/* ── New production run ── */}
        <div className="rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4 bg-white">
          <p className="text-sm font-bold text-gray-900">{revisionOf ? "Revision Run" : "New Production Run"}</p>
          {revisionOf && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
              <p className="text-xs font-semibold text-blue-700">
                Revising design — this will be revision {revisionOf.nextRev} of {revisionOf.included} included.
                {carriedRefUrl && " The original reference image is carried over — it will keep matching the same design."}
                {revisionOf.nextRev > revisionOf.included && ` Over the limit: ${REVISION_FEE_LABEL} revision fee due.`}
              </p>
              <button onClick={() => { setRevisionOf(null); setCarriedRefUrl(""); }} className="text-xs font-bold text-blue-600 hover:underline">Cancel revision</button>
            </div>
          )}

          <div>
            <label className={label}>Recreate from a single image (optional — reproduces ANY wrap design)</label>
            <div className="mt-1 border-2 border-dashed border-gray-300 rounded-xl p-4 text-center hover:border-[#3b82f6] transition-colors">
              <input id="cwp-ref" type="file" accept="image/*" className="hidden" onChange={(e) => onRef(e.target.files?.[0])} />
              <label htmlFor="cwp-ref" className="cursor-pointer flex flex-col items-center gap-2">
                {refPreview ? (
                  <img src={refPreview} alt="reference" className="max-h-40 rounded-lg border border-gray-200" />
                ) : (
                  <>
                    <Upload className="w-8 h-8 text-gray-400" />
                    <span className="text-sm font-medium text-gray-700">Upload a wrap photo, approved design, or 2D proof</span>
                    <span className="text-xs text-gray-400">The pipeline reproduces it flat-first, then rebuilds the whole production pack</span>
                  </>
                )}
              </label>
            </div>
          </div>

          <div>
            <label className={label}>Design brief{refFile ? " (optional with a reference image)" : ""}</label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder='e.g. "Summit Realty Group — luxury gold/charcoal skyline wrap, clean and high-end"'
              className={`${inputCls} text-sm`}
            />
          </div>

          <div className="flex gap-2">
            {(["commercial", "restyle"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold capitalize transition ${
                  mode === m ? "border-[#3b82f6] bg-blue-50 text-gray-900" : "border-gray-300 text-gray-500"
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {mode === "commercial" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div><label className={label}>Company</label><Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={inputCls} /></div>
              <div><label className={label}>Phone</label><Input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} /></div>
              <div><label className={label}>Website</label><Input value={website} onChange={(e) => setWebsite(e.target.value)} className={inputCls} /></div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div><label className={label}>Year</label><Input value={year} onChange={(e) => setYear(e.target.value)} className={inputCls} /></div>
            <div><label className={label}>Make</label><Input value={make} onChange={(e) => setMake(e.target.value)} className={inputCls} /></div>
            <div><label className={label}>Model</label><Input value={model} onChange={(e) => setModel(e.target.value)} className={inputCls} /></div>
            <div>
              <label className={label}>Body type</label>
              <select value={bodyType} onChange={(e) => setBodyType(e.target.value as any)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 mt-1 bg-white">
                {BODY_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div><label className={label}>Finish</label><Input value={finish} onChange={(e) => setFinish(e.target.value)} className={inputCls} /></div>
          </div>

          {!canRun && !busy && (
            <p className="text-xs font-semibold text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
              To enable the Run button: enter a design brief (or upload a photo) AND the vehicle Make + Model.
            </p>
          )}
          {pipelineError && (
            <p className="text-sm font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {pipelineError}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-4 pt-1">
            <Button onClick={runPipeline} disabled={!canRun} className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white">
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              Run Full Production Pipeline
            </Button>
            {steps.length > 0 && (
              <div className="flex flex-col gap-1">
                {steps.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    {s.state === "done" && <Check className="w-3.5 h-3.5 text-green-600" />}
                    {s.state === "running" && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />}
                    {s.state === "failed" && <span className="text-red-600 font-bold">✕</span>}
                    {s.state === "idle" && <span className="w-3.5 h-3.5 rounded-full border border-gray-300 inline-block" />}
                    <span className={s.state === "failed" ? "text-red-600" : "text-gray-600"}>{s.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Saved production runs + every backend asset ── */}
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3">
            <Layers className="w-4 h-4 text-gray-400" />
            <h2 className="text-lg font-bold text-gray-900">Saved Production Runs</h2>
            <span className="text-xs text-gray-400">({runs?.length || 0})</span>
          </div>

          {!runs?.length && (
            <p className="text-sm text-gray-500 border border-gray-200 rounded-xl p-6 text-center">
              No production runs yet — run the pipeline above and every generated asset lands here.
            </p>
          )}

          <div className="space-y-3">
            {runs?.map((run) => {
              const runAssets = (assets || []).filter((a) => a.run_id === run.id);
              const open = openRun === run.id;
              return (
                <div key={run.id} className="rounded-2xl border border-gray-200 shadow-sm bg-white overflow-hidden">
                  <button onClick={() => setOpenRun(open ? null : run.id)} className="w-full flex flex-wrap items-center gap-3 px-5 py-3 text-left hover:bg-gray-50">
                    <span className="text-sm font-bold text-gray-900">
                      {run.vehicle_year} {run.vehicle_make} {run.vehicle_model}
                    </span>
                    {run.company_name && <span className="text-sm text-gray-600">· {run.company_name}</span>}
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      run.status === "complete" ? "bg-blue-50 text-blue-600 border border-blue-200" :
                      run.status === "failed" ? "bg-red-50 text-red-600 border border-red-200" :
                      "bg-orange-50 text-orange-700 border border-orange-200"
                    }`}>{run.status}</span>
                    <span className="text-[10px] uppercase font-semibold text-gray-400">{run.mode}</span>
                    {(run.revision_number ?? 0) > 0 && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                        rev {run.revision_number}/{run.included_revisions ?? INCLUDED_REVISIONS}
                      </span>
                    )}
                    {run.paid ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200">PAID</span>
                    ) : (run.revision_number ?? 0) > (run.included_revisions ?? INCLUDED_REVISIONS) ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200">REVISION FEE DUE {REVISION_FEE_LABEL}</span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200">UNPAID</span>
                    )}
                    {run.coverage_sq_ft != null && <span className="text-xs text-gray-500">{run.coverage_sq_ft} sq ft</span>}
                    {run.dims_source && <span className="text-[10px] text-gray-400">dims: {run.dims_source}</span>}
                    <span className="ml-auto text-xs text-gray-400">{new Date(run.created_at).toLocaleString()} · {runAssets.length} assets</span>
                  </button>

                  {open && (
                    <div className="px-5 pb-5 space-y-5 border-t border-gray-100 pt-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="outline" className="border-gray-300 text-gray-700" onClick={() => startRevision(run)} disabled={busy}>
                          Revise this design
                        </Button>
                        <Button size="sm" variant="outline" className="border-gray-300 text-gray-700" onClick={() => markPaid(run, !run.paid)}>
                          {run.paid ? "Mark unpaid" : "Mark paid (release print files)"}
                        </Button>
                        {!run.paid && (
                          <span className="text-[11px] font-semibold text-orange-700">
                            Pay-to-play: print files are NOT released to the customer until this run is marked paid.
                          </span>
                        )}
                      </div>
                      {run.prompt && <p className="text-xs text-gray-500">Brief: “{run.prompt}”</p>}
                      {ASSET_SECTIONS.map((section) => {
                        const items = runAssets.filter((a) => section.kinds.includes(a.kind));
                        if (!items.length) return null;
                        return (
                          <div key={section.title}>
                            <p className="text-xs font-bold text-gray-900 mb-2">
                              {section.title}
                              {section.kinds.includes("panel_print") && !run.paid && (
                                <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 align-middle">
                                  LOCKED until paid
                                </span>
                              )}
                            </p>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              {items.map((a) => (
                                <div key={a.id} className="rounded-lg border border-gray-200 overflow-hidden bg-gray-50">
                                  <a href={a.url} target="_blank" rel="noreferrer">
                                    <img
                                      src={a.url}
                                      alt={a.label || a.kind}
                                      loading="lazy"
                                      className="w-full aspect-video object-contain"
                                      style={TRANSPARENT_KINDS.includes(a.kind) ? checker : undefined}
                                    />
                                  </a>
                                  <div className="px-2 py-1.5 flex items-start justify-between gap-1">
                                    <div>
                                      <p className="text-[11px] font-semibold text-gray-700 leading-tight">
                                        {a.panel_label || (a.view_type ? a.view_type.replace(/[_-]/g, " ") : a.label || a.kind)}
                                      </p>
                                      {a.kind === "panel_print" && (
                                        <p className="text-[10px] text-gray-500">
                                          {a.width_inches}" × {a.height_inches}" · {a.bleed_inches}" bleed · {a.dpi} DPI
                                          {a.scale_pct != null && a.scale_pct < 100 ? ` · file @ ${a.scale_pct}% scale` : ""}
                                        </p>
                                      )}
                                    </div>
                                    <a href={a.url} target="_blank" rel="noreferrer" download className="text-gray-400 hover:text-[#3b82f6] mt-0.5">
                                      <Download className="w-3.5 h-3.5" />
                                    </a>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
