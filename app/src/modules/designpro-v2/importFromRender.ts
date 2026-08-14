/**
 * DesignPro v2 — read-only adapter from existing render records to object graphs.
 *
 * Builds a per-view ObjectGraph from a color_visualizations row WITHOUT
 * modifying it: the background panel is the view's clean background when one
 * was already lifted (admin_notes.logo_layers.backgrounds), otherwise the raw
 * render; every persisted LogoLayer (uploaded or extracted) becomes a
 * registered foreground object with its bounding box.
 *
 * IMPORTANT LIMIT (by design, stated honestly): artwork baked into the flat
 * AI render is part of the background panel — it is not an object until it
 * has been registered as one (lifted once into a transparent PNG, or
 * generated as a separate layer by the Artboard-First clean pipeline). The
 * object graph makes every REGISTERED element instantly removable; it cannot
 * pop pixels that were never separate.
 */
import type { LogoLayer, RenderLogoLayers } from "@/types/revision-logo";
import { type ObjectGraph, addObject, createGraph } from "./objectGraph";

const SIZE_TO_WIDTH_PCT: Record<string, number> = { sm: 0.12, md: 0.2, lg: 0.32 };

function layerBox(layer: LogoLayer) {
  if (layer.placement) {
    const w = layer.placement.sizePercent ?? SIZE_TO_WIDTH_PCT[layer.placement.size] ?? 0.2;
    // Height mirrors origin aspect when known, else square-ish placeholder.
    const aspect = layer.origin && layer.origin.wPct > 0 ? layer.origin.hPct / layer.origin.wPct : 1;
    const h = w * aspect;
    return {
      xPct: layer.placement.xPct - w / 2,
      yPct: layer.placement.yPct - h / 2,
      wPct: w,
      hPct: h,
    };
  }
  if (layer.origin) {
    // RenderElementSeparator stores origin as center-x/y + size.
    return {
      xPct: layer.origin.xPct - layer.origin.wPct / 2,
      yPct: layer.origin.yPct - layer.origin.hPct / 2,
      wPct: layer.origin.wPct,
      hPct: layer.origin.hPct,
    };
  }
  return { xPct: 0.4, yPct: 0.4, wPct: 0.2, hPct: 0.2 };
}

export interface RenderRecordLike {
  render_urls?: Record<string, string> | null;
  admin_notes?: string | null;
}

export function parseLogoLayers(render: RenderRecordLike): RenderLogoLayers {
  try {
    const notes = JSON.parse(render.admin_notes || "{}");
    return (notes.logo_layers || {}) as RenderLogoLayers;
  } catch {
    return {};
  }
}

/** Views available on the record, excluding spin frames. */
export function availableViews(render: RenderRecordLike): string[] {
  return Object.entries(render.render_urls || {})
    .filter(([key, url]) => typeof url === "string" && !!url && !key.includes("spin"))
    .map(([key]) => key);
}

export function buildGraphFromRender(render: RenderRecordLike, viewKey: string): ObjectGraph | null {
  const urls = (render.render_urls || {}) as Record<string, string>;
  const logoLayers = parseLogoLayers(render);

  const backgroundUrl = logoLayers.backgrounds?.[viewKey] || urls[viewKey];
  if (!backgroundUrl) return null;

  let graph = createGraph(viewKey, backgroundUrl);

  const layers = logoLayers.layers?.[viewKey] || [];
  for (const layer of layers) {
    graph = addObject(graph, {
      id: layer.id,
      type: layer.kind === "uploaded" ? "overlay" : "section",
      name: layer.name || (layer.kind === "uploaded" ? "Uploaded logo" : "Extracted element"),
      sourceUrl: layer.svgUrl || layer.sourceUrl,
      box: layerBox(layer),
      rotationDeg: layer.placement?.rotationDeg,
    });
  }

  return graph;
}
