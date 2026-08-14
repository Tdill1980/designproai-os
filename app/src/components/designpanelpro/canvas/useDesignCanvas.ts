import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  CanvasDocument,
  Layer,
  RasterLayer,
  TextLayer,
  NEUTRAL_FILTERS,
  defaultCanvasDocument,
  newLayerId,
} from "./types";
import { rasterizeTextLayer } from "./rasterizeTextLayer";

const TABLE = "design_canvas_documents";
// Untyped because design_canvas_documents is not in the generated types.ts.
const db = supabase as any;

type LayerPatch = Partial<RasterLayer> & Partial<TextLayer>;
const HISTORY_LIMIT = 60;
const COALESCE_MS = 600;

/**
 * Owns the layer document: state, undo/redo history, mutations, autosave, and
 * the full-resolution flatten/export round-trip (text layers are rasterized on
 * the client first). The Konva editor is a pure view over what this returns.
 */
export function useDesignCanvas(initialDocId?: string) {
  const [doc, setDoc] = useState<CanvasDocument>(defaultCanvasDocument());
  const [docId, setDocId] = useState<string | undefined>(initialDocId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!initialDocId);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dirty, setDirty] = useState(false);

  // ---- history ----------------------------------------------------------
  const past = useRef<CanvasDocument[]>([]);
  const future = useRef<CanvasDocument[]>([]);
  const lastAction = useRef<{ key: string; t: number }>({ key: "", t: 0 });
  const [histTick, setHistTick] = useState(0); // forces re-render for canUndo/canRedo
  const bump = () => setHistTick((t) => t + 1);

  const checkpoint = (prev: CanvasDocument, actionKey?: string) => {
    const now = Date.now();
    const coalesce = !!actionKey && lastAction.current.key === actionKey && now - lastAction.current.t < COALESCE_MS;
    if (!coalesce) {
      past.current.push(prev);
      if (past.current.length > HISTORY_LIMIT) past.current.shift();
    }
    future.current = [];
    lastAction.current = { key: actionKey || `a${now}`, t: now };
  };

  // ---- load -------------------------------------------------------------
  useEffect(() => {
    if (!initialDocId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await db.from(TABLE).select("*").eq("id", initialDocId).maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        toast.error("Could not load this design.");
      } else {
        setDoc({ id: data.id, name: data.name, canvas: data.canvas, layers: data.layers || [] });
        setDocId(data.id);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [initialDocId]);

  // ---- core mutate ------------------------------------------------------
  const mutate = useCallback((fn: (d: CanvasDocument) => CanvasDocument, actionKey?: string) => {
    setDoc((prev) => {
      checkpoint(prev, actionKey);
      return fn(prev);
    });
    setDirty(true);
    bump();
  }, []);

  const undo = useCallback(() => {
    if (!past.current.length) return;
    setDoc((cur) => {
      future.current.unshift(cur);
      return past.current.pop() as CanvasDocument;
    });
    lastAction.current = { key: "", t: 0 };
    setDirty(true);
    bump();
  }, []);

  const redo = useCallback(() => {
    if (!future.current.length) return;
    setDoc((cur) => {
      past.current.push(cur);
      return future.current.shift() as CanvasDocument;
    });
    lastAction.current = { key: "", t: 0 };
    setDirty(true);
    bump();
  }, []);

  // ---- layer mutations --------------------------------------------------
  const updateLayer = useCallback(
    (id: string, patch: LayerPatch, actionKey?: string) => {
      mutate(
        (d) => ({
          ...d,
          layers: d.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)),
        }),
        actionKey,
      );
    },
    [mutate],
  );

  const addImageLayer = useCallback(
    (src: string, naturalWidth: number, naturalHeight: number, name = "Image layer") => {
      let newId = "";
      mutate((prev) => {
        const { width: cw, height: ch } = prev.canvas;
        const target = Math.min(cw, ch) * 0.6;
        const scale = Math.min(target / naturalWidth, target / naturalHeight, 1);
        const w = Math.max(1, Math.round(naturalWidth * scale));
        const h = Math.max(1, Math.round(naturalHeight * scale));
        const layer: RasterLayer = {
          id: newLayerId(),
          name,
          type: "raster",
          src,
          cx: Math.round(cw / 2),
          cy: Math.round(ch / 2),
          width: w,
          height: h,
          rotation: 0,
          opacity: 1,
          blendMode: "normal",
          visible: true,
          filters: { ...NEUTRAL_FILTERS },
          mask: null,
        };
        newId = layer.id;
        return { ...prev, layers: [...prev.layers, layer] };
      }, `add-image-${Date.now()}`);
      if (newId) setSelectedId(newId);
    },
    [mutate],
  );

  const addTextLayer = useCallback(
    (text = "Your text") => {
      let newId = "";
      mutate((prev) => {
        const { width: cw, height: ch } = prev.canvas;
        const fontSize = Math.round(Math.min(cw, ch) * 0.12);
        const w = Math.round(cw * 0.6);
        const h = Math.round(fontSize * 1.4);
        const layer: TextLayer = {
          id: newLayerId(),
          name: text.slice(0, 24) || "Text",
          type: "text",
          text,
          fontFamily: "Poppins",
          fontSize,
          fill: "#111111",
          fontStyle: "bold",
          align: "center",
          lineHeight: 1.2,
          letterSpacing: 0,
          cx: Math.round(cw / 2),
          cy: Math.round(ch / 2),
          width: w,
          height: h,
          rotation: 0,
          opacity: 1,
          blendMode: "normal",
          visible: true,
          filters: { ...NEUTRAL_FILTERS },
          mask: null,
        };
        newId = layer.id;
        return { ...prev, layers: [...prev.layers, layer] };
      }, `add-text-${Date.now()}`);
      if (newId) setSelectedId(newId);
    },
    [mutate],
  );

  const duplicateLayer = useCallback(
    (id: string) => {
      let newId = "";
      mutate((d) => {
        const idx = d.layers.findIndex((l) => l.id === id);
        if (idx < 0) return d;
        const src = d.layers[idx];
        const copy: Layer = {
          ...src,
          id: newLayerId(),
          name: `${src.name} copy`,
          cx: src.cx + Math.round(d.canvas.width * 0.02),
          cy: src.cy + Math.round(d.canvas.height * 0.02),
        };
        newId = copy.id;
        const layers = [...d.layers];
        layers.splice(idx + 1, 0, copy);
        return { ...d, layers };
      }, `dup-${Date.now()}`);
      if (newId) setSelectedId(newId);
    },
    [mutate],
  );

  const removeLayer = useCallback(
    (id: string) => {
      mutate((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== id) }), `rm-${Date.now()}`);
      setSelectedId((cur) => (cur === id ? null : cur));
    },
    [mutate],
  );

  const reorderLayer = useCallback(
    (id: string, direction: "up" | "down") => {
      mutate((d) => {
        const idx = d.layers.findIndex((l) => l.id === id);
        if (idx < 0) return d;
        const swap = direction === "up" ? idx + 1 : idx - 1;
        if (swap < 0 || swap >= d.layers.length) return d;
        const layers = [...d.layers];
        [layers[idx], layers[swap]] = [layers[swap], layers[idx]];
        return { ...d, layers };
      }, `reorder-${Date.now()}`);
    },
    [mutate],
  );

  const setCanvasSpec = useCallback(
    (patch: Partial<CanvasDocument["canvas"]>) => {
      mutate((d) => ({ ...d, canvas: { ...d.canvas, ...patch } }), `canvas-${Date.now()}`);
    },
    [mutate],
  );

  const setName = useCallback(
    (name: string) => {
      mutate((d) => ({ ...d, name }), "rename");
    },
    [mutate],
  );

  // ---- save -------------------------------------------------------------
  const save = useCallback(async (): Promise<string | null> => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Sign in to save your design.");
        return null;
      }
      const payload = { user_id: user.id, name: doc.name, canvas: doc.canvas, layers: doc.layers };
      if (docId) {
        const { error } = await db.from(TABLE).update(payload).eq("id", docId);
        if (error) throw error;
        setDirty(false);
        return docId;
      }
      const { data, error } = await db.from(TABLE).insert(payload).select("id").single();
      if (error) throw error;
      setDocId(data.id);
      setDoc((d) => ({ ...d, id: data.id }));
      setDirty(false);
      return data.id;
    } catch (e: any) {
      toast.error("Save failed: " + (e?.message || e));
      return null;
    } finally {
      setSaving(false);
    }
  }, [doc, docId]);

  // Debounced autosave once a doc exists.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!dirty || !docId) return;
    const t = setTimeout(() => void saveRef.current(), 2500);
    return () => clearTimeout(t);
  }, [dirty, docId, doc]);

  // ---- flatten / export -------------------------------------------------
  const flatten = useCallback(
    async (format: "png" | "pdf" = "png"): Promise<{ url: string; pngUrl: string; pdfUrl?: string } | null> => {
      setExporting(true);
      try {
        const id = await save();
        const { data: { session } } = await supabase.auth.getSession();
        const { data: { user } } = await supabase.auth.getUser();
        const token = session?.access_token;
        if (!token || !user) throw new Error("Sign in first.");

        // Rasterize text layers on the client (exact fonts), upload, and
        // substitute raster layers so the server stays raster-only.
        const outLayers: RasterLayer[] = [];
        for (const layer of doc.layers) {
          if (layer.type === "raster") {
            outLayers.push(layer);
            continue;
          }
          const blob = await rasterizeTextLayer(layer);
          const path = `canvas-layers/${user.id}/text/${Date.now()}_${layer.id}.png`;
          const { error: upErr } = await supabase.storage
            .from("wrap-files")
            .upload(path, blob, { contentType: "image/png", upsert: true });
          if (upErr) throw new Error("Text rasterize upload failed: " + upErr.message);
          const { data: signed } = await supabase.storage
            .from("wrap-files")
            .createSignedUrl(path, 60 * 60 * 24 * 30);
          if (!signed?.signedUrl) throw new Error("Could not sign rasterized text.");
          outLayers.push({
            id: layer.id,
            name: layer.name,
            type: "raster",
            src: signed.signedUrl,
            cx: layer.cx,
            cy: layer.cy,
            width: layer.width,
            height: layer.height,
            rotation: layer.rotation,
            opacity: layer.opacity,
            blendMode: layer.blendMode,
            visible: layer.visible,
            filters: layer.filters,
            mask: layer.mask,
          });
        }

        const exportDoc = { ...doc, layers: outLayers };
        const res = await fetch("/api/flatten-canvas", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ document: exportDoc, doc_id: id, format }),
        });
        const data = await res.json();
        if (!res.ok || !data?.success) throw new Error(data?.error || `Flatten failed (${res.status})`);

        if (id && data.pngUrl) await db.from(TABLE).update({ flattened_url: data.pngUrl }).eq("id", id);
        toast.success(
          data.capped
            ? `Exported at ${data.effective_dpi} DPI (capped from ${data.requested_dpi}).`
            : `Exported ${data.pixel_width}×${data.pixel_height}px.`,
        );
        return { url: data.url, pngUrl: data.pngUrl, pdfUrl: data.pdfUrl };
      } catch (e: any) {
        toast.error(e?.message || "Export failed");
        return null;
      } finally {
        setExporting(false);
      }
    },
    [doc, save],
  );

  return {
    doc,
    docId,
    loading,
    saving,
    exporting,
    dirty,
    selectedId,
    setSelectedId,
    setName,
    setCanvasSpec,
    addImageLayer,
    addTextLayer,
    duplicateLayer,
    updateLayer,
    removeLayer,
    reorderLayer,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    save,
    flatten,
  };
}
